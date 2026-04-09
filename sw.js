// TabAmber — Service Worker
// Firefox: browser.tabs.discard exists; Chrome: chrome.tabs.discard
const IS_FIREFOX = typeof browser !== 'undefined';

// ─── Imports (all dynamic for ESM in service worker) ───────────────────────
const log = (await import('./lib/logger.js')).default;
const notifier = (await import('./lib/notifier.js')).default;
const health = (await import('./lib/health.js')).default;
const { clusterTabs, suspendGroup, wakeGroup } = await import('./lib/cluster.js');
const {
  getAIConfig, saveAIConfig, fetchModels,
  getPruningSuggestions, getHabitAnalysis, refineGroupNames,
  getSessionDigest, getAnomalyAlerts
} = await import('./lib/ai-connector.js');

// ─── Initialize ────────────────────────────────────────────────────────────
await Promise.all([log.init(), notifier.init(), health.init()]);

log.info('TabAmber service worker started', { firefox: IS_FIREFOX });

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

const check = async (forceAll = false) => {
  try {
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
    const tabs = await chrome.tabs.query({ discarded: false, active: false, url: '*://*/*' });

    let suspended = 0;
    let skipped = 0;

    for (const tab of tabs) {
      if (tab.active) continue;
      if (prefs.pinned && tab.pinned) { skipped++; continue; }
      if (prefs.audio && tab.audible) { skipped++; continue; }

      // skip tabs in collapsed groups — they're already "group-suspended"
      if (tab.groupId !== -1) {
        try {
          const group = await chrome.tabGroups.get(tab.groupId);
          if (group.collapsed) { skipped++; continue; }
        } catch { }
      }

      // whitelist check
      let hostname;
      try {
        ({ hostname } = new URL(tab.url));
        if (prefs.whitelist.some(h => hostname === h || hostname.endsWith('.' + h))) {
          skipped++;
          continue;
        }
      } catch {
        skipped++;
        continue; // unparseable URL, skip
      }

      // get in-page metadata
      const injectResult = await safeInject(tab.id, 'inject/meta.js');
      if (!injectResult.ok) { skipped++; continue; }

      let meta = {};
      try {
        const results = injectResult.results;
        const merged = Object.assign({}, ...results.map(r => r.result || {}));
        merged.forms = results.some(r => r.result && r.result.forms);
        merged.audible = results.some(r => r.result && r.result.audible);
        merged.paused = results.some(r => r.result && r.result.paused);
        meta = merged;
      } catch (err) {
        log.debug(`Failed to merge meta for tab ${tab.id}: ${err.message}`);
        skipped++;
        continue;
      }

      if (prefs.forms && meta.forms) { skipped++; continue; }
      if (prefs.audio && meta.audible) { skipped++; continue; }
      if (prefs.paused && meta.paused) { skipped++; continue; }
      if (!meta.ready && !forceAll) { skipped++; continue; }

      // force-suspend high memory tabs regardless of time
      if (prefs.memory_enabled && meta.memory && meta.memory > prefs.memory_mb * 1024 * 1024) {
        log.info(`Force-suspending high memory tab ${tab.id} (${Math.round(meta.memory / 1048576)}MB)`);
        health.inc('tabsSuspended');
        tabsDiscard(tab.id);
        suspended++;
        continue;
      }

      // time-based suspend
      const lastVisit = meta.time || 0;
      if (!forceAll && lastVisit > cutoff) { skipped++; continue; }

      log.info(`Suspending tab ${tab.id} (inactive ${Math.round((Date.now() - lastVisit) / 60000)}min)`);
      health.inc('tabsSuspended');
      tabsDiscard(tab.id);
      suspended++;
    }

    log.info(`Suspend check complete: ${suspended} suspended, ${skipped} skipped`);
  } catch (err) {
    health.recordError(`Suspend check failed: ${err.message}`, 'CHECK_ERROR');
    notifier.error(`Suspend check failed: ${err.message}`, { error: err.message, stack: err.stack });
    log.error(`Suspend check failed`, { error: err.message, stack: err.stack });
  }
};

// ─── Phase 2: Local tab clustering & group management ─────────────────────

// Scrape categorization signals from all non-discarded tabs
const scrapeAllSignals = async () => {
  const tabs = await chrome.tabs.query({ discarded: false, url: '*://*/*' });
  const signals = [];

  for (const tab of tabs) {
    if (tab.active) continue;
    if (tab.pinned) continue;

    const result = await safeInject(tab.id, 'inject/classify.js');
    if (result.ok && result.results?.[0]?.result?.ready) {
      signals.push({ tabId: tab.id, signal: result.results[0].result });
    }
  }

  return signals;
};

// Run clustering, create Chrome tab groups
const autoGroup = async () => {
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
        created.push({ group: g.group, tabIds: g.tabIds, groupId });
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

// Suspend all tabs within a specific group
const suspendGroupById = async (groupId) => {
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
  const signals = [];

  for (const tab of tabs) {
    if (tab.active || tab.pinned) continue;

    const result = await safeInject(tab.id, 'inject/classify.js');
    if (!result.ok || !result.results?.[0]?.result?.ready) continue;

    const createdDaysAgo = tab.lastAccessed ? Math.floor((Date.now() - tab.lastAccessed) / 86400000) : 0;
    signals.push({
      tabId: tab.id,
      signal: result.results[0].result,
      age: createdDaysAgo,
      visits: 0,
      lastSeen: createdDaysAgo,
      memory: tab.memory?.usedJSHeapSize || 0,
    });
  }

  return signals;
};

// ─── Message handler ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.method) {
    // Phase 1
    case 'suspend-all':
      check(true);
      break;

    // Phase 2
    case 'auto-group':
      autoGroup().then(sendResponse);
      return true;

    case 'suspend-group':
      suspendGroupById(request.groupId).then(sendResponse);
      return true;

    case 'wake-group':
      wakeGroupById(request.groupId).then(sendResponse);
      return true;

    case 'get-groups':
      chrome.tabGroups.query({}).then(groups => sendResponse({ groups })).catch(() => sendResponse({ groups: [] }));
      return true;

    // Phase 3: AI
    case 'ai-fetch-models':
      fetchModels(request.endpoint, request.apiKey)
        .then(models => sendResponse({ models }))
        .catch(err => sendResponse({ models: [], error: err.message }));
      return true;

    case 'ai-pruning':
      (async () => {
        health.inc('aiCalls');
        const config = await getAIConfig();
        config.apiKey = request.apiKey;
        if (!config.endpoint || !config.model) {
          health.inc('aiErrors');
          sendResponse({ error: 'AI not configured — set endpoint and model in settings' });
          return;
        }
        try {
          const signals = await buildAISignals();
          const result = await getPruningSuggestions(config, signals);
          sendResponse(result);
        } catch (err) {
          health.inc('aiErrors');
          notifier.error(`AI pruning failed: ${err.message}`);
          sendResponse({ error: err.message });
        }
      })();
      return true;

    case 'ai-habits':
      (async () => {
        health.inc('aiCalls');
        const config = await getAIConfig();
        config.apiKey = request.apiKey;
        if (!config.endpoint || !config.model) {
          health.inc('aiErrors');
          sendResponse({ error: 'AI not configured' });
          return;
        }
        try {
          const history = request.tabHistory || [];
          const result = await getHabitAnalysis(config, history);
          sendResponse(result);
        } catch (err) {
          health.inc('aiErrors');
          notifier.error(`AI habit analysis failed: ${err.message}`);
          sendResponse({ error: err.message });
        }
      })();
      return true;

    case 'ai-refine-names':
      (async () => {
        health.inc('aiCalls');
        const config = await getAIConfig();
        config.apiKey = request.apiKey;
        if (!config.endpoint || !config.model) {
          health.inc('aiErrors');
          sendResponse({ error: 'AI not configured' });
          return;
        }
        try {
          const result = await refineGroupNames(config, request.groups || []);
          sendResponse({ groups: result });
        } catch (err) {
          health.inc('aiErrors');
          notifier.error(`AI name refinement failed: ${err.message}`);
          sendResponse({ error: err.message });
        }
      })();
      return true;

    case 'ai-digest':
      (async () => {
        health.inc('aiCalls');
        const config = await getAIConfig();
        config.apiKey = request.apiKey;
        if (!config.endpoint || !config.model) {
          health.inc('aiErrors');
          sendResponse({ error: 'AI not configured' });
          return;
        }
        try {
          const signals = await buildAISignals();
          const result = await getSessionDigest(config, signals, request.stats || {});
          sendResponse({ digest: result });
        } catch (err) {
          health.inc('aiErrors');
          notifier.error(`AI session digest failed: ${err.message}`);
          sendResponse({ error: err.message });
        }
      })();
      return true;

    case 'ai-anomaly':
      (async () => {
        health.inc('aiCalls');
        const config = await getAIConfig();
        config.apiKey = request.apiKey;
        if (!config.endpoint || !config.model) {
          health.inc('aiErrors');
          sendResponse({ error: 'AI not configured' });
          return;
        }
        try {
          const signals = await buildAISignals();
          const result = await getAnomalyAlerts(config, signals);
          sendResponse(result);
        } catch (err) {
          health.inc('aiErrors');
          notifier.error(`AI anomaly scan failed: ${err.message}`);
          sendResponse({ error: err.message });
        }
      })();
      return true;

    // Diagnostics
    case 'get-logs':
      sendResponse({ entries: log.getEntries() });
      return true;

    case 'clear-logs':
      log.clear();
      sendResponse({ ok: true });
      return true;

    case 'get-health':
      sendResponse({ health: health.snapshot() });
      return true;

    case 'get-critical':
      sendResponse({ critical: notifier.getCriticalErrors() });
      return true;

    case 'clear-badge':
      notifier.clearBadge().then(() => sendResponse({ ok: true }));
      return true;

    // Runtime config update (from options page)
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
      return true;
  }
});

// ─── Alarms & lifecycle ───────────────────────────────────────────────────

chrome.alarms.create('suspend.check', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'suspend.check') check();
});

chrome.runtime.onStartup.addListener(async () => {
  log.info('Browser startup');
  health.inc('tabsSuspended', 0); // reset doesn't inc, just marks init
  const prefs = await getPrefs();
  if (prefs.suspend_on_startup) check(true);
  else check();
});

chrome.runtime.onInstalled.addListener(check);

// Track tab wake (user clicks a discarded tab)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.discarded === false) {
    health.inc('tabsWoken');
    log.info(`Tab ${tabId} woken`, { title: tab.title?.slice(0, 50) });
  }
});
