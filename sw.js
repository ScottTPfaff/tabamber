// Firefox: browser.tabs.discard exists; Chrome: chrome.tabs.discard
// Both support the chrome.* namespace via WebExtensions API
const IS_FIREFOX = typeof browser !== 'undefined';

const tabsDiscard = (tabId) => {
  if (IS_FIREFOX) {
    browser.tabs.discard(tabId).catch(() => { });
  } else {
    chrome.tabs.discard(tabId, () => chrome.runtime.lastError);
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

// ─── Phase 1: Time-based suspension ───────────────────────────────────────

const check = async (forceAll = false) => {
  const prefs = await getPrefs();

  // if idle_only, skip unless system is idle
  if (prefs.idle_only && !forceAll) {
    const state = await new Promise(resolve =>
      chrome.idle.queryState(prefs.idle_timeout * 60, resolve)
    );
    if (state !== 'idle') return;
  }

  const cutoff = Date.now() - prefs.period * 60 * 1000;
  const tabs = await chrome.tabs.query({ discarded: false, active: false, url: '*://*/*' });

  for (const tab of tabs) {
    if (tab.active) continue;
    if (prefs.pinned && tab.pinned) continue;
    if (prefs.audio && tab.audible) continue;

    // skip tabs in collapsed groups — they're already "group-suspended"
    if (tab.groupId !== -1) {
      try {
        const group = await chrome.tabGroups.get(tab.groupId);
        if (group.collapsed) continue;
      } catch { }
    }

    // whitelist check
    try {
      const { hostname } = new URL(tab.url);
      if (prefs.whitelist.some(h => hostname === h || hostname.endsWith('.' + h))) continue;
    } catch { continue; }

    // get in-page metadata
    let meta = {};
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ['inject/meta.js']
      });
      const merged = Object.assign({}, ...results.map(r => r.result || {}));
      merged.forms = results.some(r => r.result && r.result.forms);
      merged.audible = results.some(r => r.result && r.result.audible);
      merged.paused = results.some(r => r.result && r.result.paused);
      meta = merged;
    } catch { continue; }

    if (prefs.forms && meta.forms) continue;
    if (prefs.audio && meta.audible) continue;
    if (prefs.paused && meta.paused) continue;
    if (!meta.ready && !forceAll) continue;

    // force-suspend high memory tabs regardless of time
    if (prefs.memory_enabled && meta.memory && meta.memory > prefs.memory_mb * 1024 * 1024) {
      tabsDiscard(tab.id);
      continue;
    }

    // time-based suspend
    const lastVisit = meta.time || 0;
    if (!forceAll && lastVisit > cutoff) continue;

    tabsDiscard(tab.id);
  }
};

// ─── Phase 2: Local tab clustering & group management ─────────────────────

// Import clustering module (ESM in service worker requires dynamic import)
const { clusterTabs, suspendGroup, wakeGroup } = await import('./lib/cluster.js');

// ─── Phase 3: AI Intelligence Layer ───────────────────────────────────────

// Import AI connector (ESM)
const {
  getAIConfig, saveAIConfig, fetchModels,
  getPruningSuggestions, getHabitAnalysis, refineGroupNames,
  getSessionDigest, getAnomalyAlerts
} = await import('./lib/ai-connector.js');

// Build enriched tab signals for AI (combining classify + local metadata)
const buildAISignals = async () => {
  const tabs = await chrome.tabs.query({ discarded: false, url: '*://*/*' });
  const signals = [];

  for (const tab of tabs) {
    if (tab.active || tab.pinned) continue;

    let signal = {};
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: false },
        files: ['inject/classify.js']
      });
      if (results[0]?.result?.ready) {
        signal = results[0].result;
      } else continue;
    } catch { continue; }

    // Add local metadata
    const createdDaysAgo = tab.lastAccessed ? Math.floor((Date.now() - tab.lastAccessed) / 86400000) : 0;
    signals.push({
      tabId: tab.id,
      signal,
      age: createdDaysAgo,
      visits: 0, // TODO: track revisit count in storage
      lastSeen: createdDaysAgo,
      memory: tab.memory?.usedJSHeapSize || 0,
    });
  }

  return signals;
};

// Scrape categorization signals from all non-discarded tabs
const scrapeAllSignals = async () => {
  const tabs = await chrome.tabs.query({ discarded: false, url: '*://*/*' });
  const signals = [];

  for (const tab of tabs) {
    if (tab.active) continue;
    if (tab.pinned) continue;

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: false },
        files: ['inject/classify.js']
      });
      if (results[0]?.result?.ready) {
        signals.push({ tabId: tab.id, signal: results[0].result });
      }
    } catch { /* skip tabs that can't be scripted */ }
  }

  return signals;
};

// Run clustering, create Chrome tab groups, and optionally suspend them
const autoGroup = async () => {
  const signals = await scrapeAllSignals();
  if (signals.length < 3) return { groups: [], message: 'Not enough tabs to cluster (need 3+)' };

  const prefs = await getPrefs();
  const groups = clusterTabs(signals, prefs.cluster_threshold);

  // Create Chrome tab groups
  const created = [];
  for (const g of groups) {
    if (g.tabIds.length < 1) continue;

    // Create group with first tab, add rest to it
    const groupId = await chrome.tabs.group({ tabIds: g.tabIds });
    await chrome.tabGroups.update(groupId, {
      title: g.group,
      collapsed: false // don't collapse — user can manually collapse to "suspend" the group
    });

    created.push({ group: g.group, tabIds: g.tabIds, groupId });
  }

  return { groups: created, message: `Created ${created.length} groups from ${signals.length} tabs` };
};

// Suspend all tabs within a specific group
const suspendGroupById = async (groupId) => {
  const tabs = await chrome.tabs.query({ groupId, discarded: false });
  for (const tab of tabs) {
    if (!tab.active && !tab.audible) {
      tabsDiscard(tab.id);
    }
  }
  // Collapse the group visually
  try {
    await chrome.tabGroups.update(groupId, { collapsed: true });
  } catch { }
};

// Wake all tabs in a group
const wakeGroupById = async (groupId) => {
  try {
    await chrome.tabGroups.update(groupId, { collapsed: false });
  } catch { }
  const tabs = await chrome.tabs.query({ groupId, discarded: true });
  // Wake the first tab (others wake on click)
  if (tabs.length > 0) {
    chrome.tabs.update(tabs[0].id, { active: true });
  }
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
      suspendGroupById(request.groupId).then(() => sendResponse({ ok: true }));
      return true;

    case 'wake-group':
      wakeGroupById(request.groupId).then(() => sendResponse({ ok: true }));
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
        const config = await getAIConfig();
        config.apiKey = request.apiKey; // session-only
        if (!config.endpoint || !config.model) {
          sendResponse({ error: 'AI not configured — set endpoint and model in settings' });
          return;
        }
        const signals = await buildAISignals();
        const result = await getPruningSuggestions(config, signals);
        sendResponse(result);
      })();
      return true;

    case 'ai-habits':
      (async () => {
        const config = await getAIConfig();
        config.apiKey = request.apiKey;
        if (!config.endpoint || !config.model) {
          sendResponse({ error: 'AI not configured' });
          return;
        }
        const history = request.tabHistory || [];
        const result = await getHabitAnalysis(config, history);
        sendResponse(result);
      })();
      return true;

    case 'ai-refine-names':
      (async () => {
        const config = await getAIConfig();
        config.apiKey = request.apiKey;
        if (!config.endpoint || !config.model) {
          sendResponse({ error: 'AI not configured' });
          return;
        }
        const result = await refineGroupNames(config, request.groups || []);
        sendResponse({ groups: result });
      })();
      return true;

    case 'ai-digest':
      (async () => {
        const config = await getAIConfig();
        config.apiKey = request.apiKey;
        if (!config.endpoint || !config.model) {
          sendResponse({ error: 'AI not configured' });
          return;
        }
        const signals = await buildAISignals();
        const result = await getSessionDigest(config, signals, request.stats || {});
        sendResponse({ digest: result });
      })();
      return true;

    case 'ai-anomaly':
      (async () => {
        const config = await getAIConfig();
        config.apiKey = request.apiKey;
        if (!config.endpoint || !config.model) {
          sendResponse({ error: 'AI not configured' });
          return;
        }
        const signals = await buildAISignals();
        const result = await getAnomalyAlerts(config, signals);
        sendResponse(result);
      })();
      return true;
  }
});

// ─── Alarms & lifecycle ───────────────────────────────────────────────────

// Check every minute
chrome.alarms.create('suspend.check', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'suspend.check') check();
});

// Startup
chrome.runtime.onStartup.addListener(async () => {
  const prefs = await getPrefs();
  if (prefs.suspend_on_startup) check(true);
  else check();
});

chrome.runtime.onInstalled.addListener(check);
