// TabAmber — Service Worker
// Firefox: browser.tabs.discard exists; Chrome: chrome.tabs.discard
import log from './lib/logger.js';
import notifier from './lib/notifier.js';
import health from './lib/health.js';
import { clusterTabs } from './lib/cluster.js';
import {
  getAIConfig, fetchModels,
  getPruningSuggestions, getHabitAnalysis, refineGroupNames,
  getSessionDigest, getAnomalyAlerts
} from './lib/ai-connector.js';

const HAS_TAB_GROUPS = typeof chrome !== 'undefined' && !!chrome.tabGroups;

const IS_FIREFOX = typeof browser !== 'undefined';

// Initialize on first use
let initialized = false;
const ensureInit = async () => {
  if (!initialized) {
    await Promise.all([log.init(), notifier.init(), health.init()]);
    log.info('TabAmber service worker started', { firefox: IS_FIREFOX });
    initialized = true;
  }
};

ensureInit();

// ─── Helpers ───────────────────────────────────────────────────────────────

const tabsDiscard = (tabId) => {
  if (IS_FIREFOX) {
    browser.tabs.discard(tabId).catch(err => {
      health.inc('discardErrors');
      health.recordError(`Discard failed: ${err.message}`, 'DISCARD_ERROR');
      notifier.warn(`Failed to discard tab ${tabId}`, { tabId, error: err.message });
    });
  } else {
    chrome.tabs.discard(tabId, () => {
      if (chrome.runtime.lastError) {
        health.inc('discardErrors');
        health.recordError(`Discard failed: ${chrome.runtime.lastError.message}`, 'DISCARD_ERROR');
        log.warn(`Discard failed for tab ${tabId}: ${chrome.runtime.lastError.message}`);
      }
    });
  }
};

const DEFAULTS = {
  period: 60,           // minutes inactive before suspend
  whitelist: [],        // hostnames to never suspend
  pinned: true,         // never suspend pinned tabs
  audio: true,          // never suspend tabs playing audio
  paused: true,         // never suspend tabs with a paused media player
  forms: true,          // never suspend tabs with unsaved form data
  idle_only: false,     // only suspend when system is idle
  idle_timeout: 5,      // minutes of no input to consider system idle
  memory_enabled: false,// force-suspend tabs over memory threshold regardless of time
  memory_mb: 500,       // MB threshold for force-suspend
  suspend_on_startup: false, // immediately suspend all tabs on browser start
  // Phase 2: grouping
  auto_group: false,    // auto-cluster tabs by topic
  cluster_threshold: 0.35, // similarity threshold for clustering
};

const getPrefs = () => new Promise(resolve =>
  chrome.storage.local.get(DEFAULTS, resolve)
);

// Safe script injection with error tracking
const safeInject = async (tabId, file) => {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: [file]
    });
    return { ok: true, results };
  } catch (err) {
    // chrome:// pages and extension pages are expected to fail — log as debug, not error
    if (err.message?.includes('chrome://') || err.message?.includes('cannot access')) {
      log.debug(`Script injection skipped for tab ${tabId}: ${err.message}`);
    } else {
      health.inc('injectErrors');
      log.warn(`Script injection failed for tab ${tabId}`, { file, error: err.message });
    }
    return { ok: false, error: err.message };
  }
};

// ─── Phase 1: Time-based suspension ───────────────────────────────────────

// Prevent overlapping check() runs (alarm + shortcut + startup can race).
let checkInFlight = null;

const check = async (forceAll = false) => {
  if (checkInFlight) {
    log.debug('check() already in flight, skipping re-entry');
    return checkInFlight;
  }
  checkInFlight = (async () => {
  try {
    // Check if suspension is paused
    const sessionState = await chrome.storage.session.get({ suspension_paused: false });
    if (sessionState.suspension_paused && !forceAll) {
      log.debug('Suspension is paused, skipping');
      return;
    }

    const prefs = await getPrefs();

    // if idle_only, skip unless system is idle
    if (prefs.idle_only && !forceAll) {
      const state = await new Promise(resolve =>
        chrome.idle.queryState(prefs.idle_timeout * 60, resolve)
      );
      if (state !== 'idle') {
        log.debug('System not idle, skipping suspend check');
        return;
      }
    }

    const cutoff = Date.now() - prefs.period * 60 * 1000;
    // `active: false` is declared in the query — no need to re-check in the loop.
    const tabs = await chrome.tabs.query({ discarded: false, active: false, url: '*://*/*' });

    // Pre-filter cheap synchronous checks (pinned, audible, collapsed groups, whitelist)
    // so we only inject into tabs that are actually suspension candidates.
    const candidates = [];
    let skipped = 0;
    for (const tab of tabs) {
      if (prefs.pinned && tab.pinned) { skipped++; continue; }
      if (prefs.audio && tab.audible) { skipped++; continue; }

      if (HAS_TAB_GROUPS && tab.groupId !== undefined && tab.groupId !== -1) {
        try {
          const group = await chrome.tabGroups.get(tab.groupId);
          if (group.collapsed) { skipped++; continue; }
        } catch { /* group not available: fall through */ }
      }

      let hostname;
      try {
        ({ hostname } = new URL(tab.url));
      } catch {
        skipped++;
        continue;
      }
      if (prefs.whitelist.some(h => hostname === h || hostname.endsWith('.' + h))) {
        skipped++;
        continue;
      }
      candidates.push(tab);
    }

    // Inject meta.js in parallel — large tab counts were previously O(N) serial.
    const metas = await Promise.all(candidates.map(async tab => {
      const injectResult = await safeInject(tab.id, 'inject/meta.js');
      if (!injectResult.ok) return { tab, meta: null };
      try {
        const results = injectResult.results;
        const merged = Object.assign({}, ...results.map(r => r.result || {}));
        merged.forms = results.some(r => r.result && r.result.forms);
        merged.audible = results.some(r => r.result && r.result.audible);
        merged.paused = results.some(r => r.result && r.result.paused);
        return { tab, meta: merged };
      } catch (err) {
        log.debug(`Failed to merge meta for tab ${tab.id}: ${err.message}`);
        return { tab, meta: null };
      }
    }));

    let suspended = 0;

    for (const { tab, meta } of metas) {
      if (!meta) { skipped++; continue; }
      if (prefs.forms && meta.forms) { skipped++; continue; }
      // Note: tab.audible was already checked above; meta.audible is subframe/PiP signal.
      if (prefs.audio && meta.audible) { skipped++; continue; }
      if (prefs.paused && meta.paused) { skipped++; continue; }
      if (!meta.ready && !forceAll) { skipped++; continue; }

      // force-suspend high memory tabs regardless of time
      if (prefs.memory_enabled && meta.memory && meta.memory > prefs.memory_mb * 1024 * 1024) {
        log.info(`Force-suspending high memory tab ${tab.id} (${Math.round(meta.memory / 1048576)}MB)`);
        health.inc('tabsSuspended');
        tabsDiscard(tab.id);
        suspended++;
        await new Promise(r => setTimeout(r, 50)); // prevent Chrome same-process race
        continue;
      }

      // time-based suspend
      const lastVisit = meta.time || 0;
      if (!forceAll && lastVisit > cutoff) { skipped++; continue; }

      log.info(`Suspending tab ${tab.id} (inactive ${Math.round((Date.now() - lastVisit) / 60000)}min)`);
      health.inc('tabsSuspended');
      tabsDiscard(tab.id);
      suspended++;
      await new Promise(r => setTimeout(r, 50)); // prevent Chrome same-process race
    }

    log.info(`Suspend check complete: ${suspended} suspended, ${skipped} skipped`);
  } catch (err) {
    health.recordError(`Suspend check failed: ${err.message}`, 'CHECK_ERROR');
    notifier.error(`Suspend check failed: ${err.message}`, { error: err.message, stack: err.stack });
    log.error(`Suspend check failed`, { error: err.message, stack: err.stack });
  }
  })().finally(() => { checkInFlight = null; });
  return checkInFlight;
};

// ─── Phase 2: Local tab clustering & group management ─────────────────────

// Scrape categorization signals from all non-discarded tabs (parallel).
const scrapeAllSignals = async () => {
  const tabs = await chrome.tabs.query({ discarded: false, url: '*://*/*' });
  const candidates = tabs.filter(t => !t.active && !t.pinned);

  const results = await Promise.all(candidates.map(async tab => {
    const result = await safeInject(tab.id, 'inject/classify.js');
    if (result.ok && result.results?.[0]?.result?.ready) {
      return { tabId: tab.id, signal: result.results[0].result };
    }
    return null;
  }));

  return results.filter(Boolean);
};

// Run clustering, create Chrome tab groups
const autoGroup = async () => {
  if (!HAS_TAB_GROUPS) {
    return { ok: false, message: 'Tab groups are not supported in this browser version' };
  }
  try {
    const signals = await scrapeAllSignals();
    if (signals.length < 3) {
      return { ok: false, message: `Not enough tabs to cluster (need 3+, found ${signals.length})` };
    }

    const prefs = await getPrefs();
    const groups = clusterTabs(signals, prefs.cluster_threshold);

    const created = [];
    for (const g of groups) {
      if (g.tabIds.length < 1) continue;

      try {
        const groupId = await chrome.tabs.group({ tabIds: g.tabIds });
        await chrome.tabGroups.update(groupId, {
          title: g.group,
          collapsed: false
        });
        created.push({ group: g.group, title: g.group, tabIds: g.tabIds, tabCount: g.tabIds.length, groupId });
        health.inc('groupsCreated');
      } catch (err) {
        health.recordError(`Failed to create group "${g.group}": ${err.message}`, 'GROUP_ERROR');
        notifier.warn(`Failed to create group: ${g.group}`);
      }
    }

    log.info(`Auto-grouped: ${created.length} groups from ${signals.length} tabs`);
    return { ok: true, groups: created, message: `Created ${created.length} groups from ${signals.length} tabs` };
  } catch (err) {
    health.recordError(`Auto-group failed: ${err.message}`, 'AUTOGROUP_ERROR');
    notifier.error(`Auto-group failed: ${err.message}`);
    log.error(`Auto-group failed`, { error: err.message });
    return { ok: false, message: err.message };
  }
};

// Query groups along with their current tab counts (chrome.tabGroups.query
// doesn't return tabIds itself).
const listGroupsWithCounts = async () => {
  if (!HAS_TAB_GROUPS) return [];
  try {
    const groups = await chrome.tabGroups.query({});
    return Promise.all(groups.map(async g => {
      const tabs = await chrome.tabs.query({ groupId: g.id });
      return {
        id: g.id,
        title: g.title,
        color: g.color,
        collapsed: g.collapsed,
        windowId: g.windowId,
        tabIds: tabs.map(t => t.id),
        tabCount: tabs.length,
      };
    }));
  } catch (err) {
    log.debug(`listGroupsWithCounts failed: ${err.message}`);
    return [];
  }
};

// Suspend all tabs within a specific group
const suspendGroupById = async (groupId) => {
  if (!HAS_TAB_GROUPS) return { ok: false, error: 'tabGroups unavailable' };
  try {
    const tabs = await chrome.tabs.query({ groupId, discarded: false });
    let count = 0;
    for (const tab of tabs) {
      if (!tab.active && !tab.audible) {
        health.inc('tabsSuspended');
        tabsDiscard(tab.id);
        count++;
      }
    }
    await chrome.tabGroups.update(groupId, { collapsed: true });
    log.info(`Suspended group ${groupId} (${count} tabs)`);
    return { ok: true, count };
  } catch (err) {
    health.recordError(`Suspend group failed: ${err.message}`, 'SUSPEND_GROUP_ERROR');
    return { ok: false, error: err.message };
  }
};

// Wake all tabs in a group
const wakeGroupById = async (groupId) => {
  if (!HAS_TAB_GROUPS) return { ok: false, error: 'tabGroups unavailable' };
  try {
    await chrome.tabGroups.update(groupId, { collapsed: false });
    const tabs = await chrome.tabs.query({ groupId, discarded: true });
    if (tabs.length > 0) {
      health.inc('tabsWoken');
      chrome.tabs.update(tabs[0].id, { active: true });
    }
    log.info(`Woke group ${groupId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};

// ─── Phase 3: AI Intelligence Layer ───────────────────────────────────────

const buildAISignals = async () => {
  const tabs = await chrome.tabs.query({ discarded: false, url: '*://*/*' });
  const candidates = tabs.filter(t => !t.active && !t.pinned);

  const signals = await Promise.all(candidates.map(async tab => {
    const result = await safeInject(tab.id, 'inject/classify.js');
    if (!result.ok || !result.results?.[0]?.result?.ready) return null;
    const createdDaysAgo = tab.lastAccessed ? Math.floor((Date.now() - tab.lastAccessed) / 86400000) : 0;
    return {
      tabId: tab.id,
      signal: result.results[0].result,
      age: createdDaysAgo,
      visits: 0,
      lastSeen: createdDaysAgo,
      memory: tab.memory?.usedJSHeapSize || 0,
    };
  }));

  return signals.filter(Boolean);
};

// ─── Message handler ──────────────────────────────────────────────────────

// All async handlers: return true from the listener itself so Chrome keeps
// the message port open until sendResponse fires.
const runAIHandler = async (request, sendResponse, buildMessages, resultKey) => {
  health.inc('aiCalls');
  try {
    const config = await getAIConfig();
    config.apiKey = request.apiKey;
    if (!config.endpoint || !config.model) {
      health.inc('aiErrors');
      sendResponse({ error: 'AI not configured — set endpoint and model in settings' });
      return;
    }
    const result = await buildMessages(config);
    sendResponse(resultKey ? { [resultKey]: result } : result);
  } catch (err) {
    health.inc('aiErrors');
    notifier.error(`AI call failed: ${err.message}`);
    sendResponse({ error: err.message });
  }
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Fire-and-forget messages that don't need a response.
  if (request.method === 'suspend-all') {
    ensureInit().then(() => check(true));
    return false;
  }

  // Everything else is async — keep the port open.
  ensureInit().then(async () => {
    switch (request.method) {
      case 'auto-group':
        sendResponse(await autoGroup());
        return;

      case 'suspend-group':
        sendResponse(await suspendGroupById(request.groupId));
        return;

      case 'wake-group':
        sendResponse(await wakeGroupById(request.groupId));
        return;

      case 'get-groups': {
        const groups = await listGroupsWithCounts();
        sendResponse({ groups });
        return;
      }

      case 'ai-fetch-models':
        try {
          const models = await fetchModels(request.endpoint, request.apiKey);
          sendResponse({ models });
        } catch (err) {
          sendResponse({ models: [], error: err.message });
        }
        return;

      case 'ai-pruning':
        await runAIHandler(request, sendResponse, async (config) => {
          const signals = await buildAISignals();
          return await getPruningSuggestions(config, signals);
        });
        return;

      case 'ai-habits':
        await runAIHandler(request, sendResponse, async (config) => {
          return await getHabitAnalysis(config, request.tabHistory || []);
        });
        return;

      case 'ai-refine-names':
        await runAIHandler(request, sendResponse, async (config) => {
          return await refineGroupNames(config, request.groups || []);
        }, 'groups');
        return;

      case 'ai-digest':
        await runAIHandler(request, sendResponse, async (config) => {
          const signals = await buildAISignals();
          return await getSessionDigest(config, signals, request.stats || {});
        }, 'digest');
        return;

      case 'ai-anomaly':
        await runAIHandler(request, sendResponse, async (config) => {
          const signals = await buildAISignals();
          return await getAnomalyAlerts(config, signals);
        });
        return;

      case 'get-logs':
        sendResponse({ entries: log.getEntries() });
        return;

      case 'clear-logs':
        await log.clear();
        sendResponse({ ok: true });
        return;

      case 'get-health':
        sendResponse({ health: health.snapshot() });
        return;

      case 'get-critical':
        sendResponse({ critical: notifier.getCriticalErrors() });
        return;

      case 'clear-badge':
        await notifier.clearBadge();
        sendResponse({ ok: true });
        return;

      case 'update-config':
        if (request.log_level || request.log_webhook !== undefined) {
          log.setConfig({
            level: request.log_level,
            webhook: request.log_webhook,
          });
        }
        if (request.notif_badge !== undefined || request.notif_chrome !== undefined) {
          notifier.setConfig({
            notif_badge: request.notif_badge,
            notif_chrome: request.notif_chrome,
          });
        }
        sendResponse({ ok: true });
        return;

      default:
        sendResponse({ error: `Unknown method: ${request.method}` });
    }
  }).catch(err => {
    log.error('Message handler failed', { method: request.method, error: err.message });
    try { sendResponse({ error: err.message }); } catch { /* port may be closed */ }
  });

  return true; // keep port open for async sendResponse
});

// ─── Alarms & lifecycle ───────────────────────────────────────────────────

chrome.alarms.create('suspend.check', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'suspend.check') ensureInit().then(() => check());
});

// ─── Context menu ──────────────────────────────────────────────────────────

const installContextMenus = () => {
  // Remove any pre-existing items (avoids duplicate-id errors after reload).
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'tabamber-never-suspend',
      title: 'TabAmber: Never suspend this tab',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: 'tabamber-suspend-now',
      title: 'TabAmber: Suspend this tab now',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: 'tabamber-whitelist-add',
      title: 'TabAmber: Add site to whitelist',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: 'tabamber-separator',
      type: 'separator',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: 'tabamber-open-diagnostics',
      title: 'TabAmber: Open Diagnostics',
      contexts: ['action'],
    });
  });
};

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  switch (info.menuItemId) {
    case 'tabamber-never-suspend':
      try {
        const { hostname } = new URL(tab.url);
        const prefs = await getPrefs();
        if (!prefs.whitelist.includes(hostname)) {
          prefs.whitelist.push(hostname);
          chrome.storage.local.set({ whitelist: prefs.whitelist });
          notifier.info(`Added ${hostname} to whitelist`);
        }
      } catch { }
      break;
    case 'tabamber-suspend-now':
      log.info(`Context menu: suspending tab ${tab.id}`);
      health.inc('tabsSuspended');
      tabsDiscard(tab.id);
      break;
    case 'tabamber-whitelist-add':
      try {
        const { hostname } = new URL(tab.url);
        const prefs = await getPrefs();
        if (!prefs.whitelist.includes(hostname)) {
          prefs.whitelist.push(hostname);
          chrome.storage.local.set({ whitelist: prefs.whitelist });
          notifier.info(`Added ${hostname} to whitelist`);
        } else {
          notifier.info(`${hostname} is already whitelisted`);
        }
      } catch { }
      break;
    case 'tabamber-open-diagnostics':
      chrome.tabs.create({ url: 'diagnostics.html' });
      break;
  }
});

// ─── Keyboard shortcuts ────────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  switch (command) {
    case 'suspend-all':
      log.info('Keyboard shortcut: suspend all');
      check(true);
      break;
    case 'auto-group':
      log.info('Keyboard shortcut: auto-group');
      autoGroup();
      break;
    case 'toggle-pause':
      const stored = await chrome.storage.session.get({ suspension_paused: false });
      const paused = !stored.suspension_paused;
      await chrome.storage.session.set({ suspension_paused: paused });
      notifier.info(paused ? 'Suspension paused' : 'Suspension resumed');
      if (paused) {
        chrome.action.setBadgeText({ text: '⏸' });
        chrome.action.setBadgeBackgroundColor({ color: '#666' });
      } else {
        chrome.action.setBadgeText({ text: '' });
      }
      log.info(`Suspension ${paused ? 'paused' : 'resumed'}`);
      break;
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureInit();
  log.info('Browser startup');
  const prefs = await getPrefs();
  if (prefs.suspend_on_startup) check(true);
  else check();
});

// Single onInstalled listener: install context menus + kick off a first check.
chrome.runtime.onInstalled.addListener(async () => {
  await ensureInit();
  installContextMenus();
  check();
});

// Track tab wake (user clicks a discarded tab). We deliberately do NOT log
// the tab title — users may have configured a log_webhook that streams
// entries to an external URL, and the README promises titles never leave
// the extension.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.discarded === false) {
    health.inc('tabsWoken');
    log.info(`Tab ${tabId} woken`);
  }
});
