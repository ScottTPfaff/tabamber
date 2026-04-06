// Firefox: browser.tabs.discard exists; Chrome: chrome.tabs.discard
// Both support the chrome.* namespace via WebExtensions API
const IS_FIREFOX = typeof browser !== 'undefined';

const tabsDiscard = (tabId) => {
  if (IS_FIREFOX) {
    browser.tabs.discard(tabId).catch(() => {});
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
};

const getPrefs = () => new Promise(resolve =>
  chrome.storage.local.get(DEFAULTS, resolve)
);

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

// Check every minute
chrome.alarms.create('suspend.check', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'suspend.check') check();
});

// Messages from popup
chrome.runtime.onMessage.addListener((request) => {
  if (request.method === 'suspend-all') check(true);
});

// Startup
chrome.runtime.onStartup.addListener(async () => {
  const prefs = await getPrefs();
  if (prefs.suspend_on_startup) check(true);
  else check();
});

chrome.runtime.onInstalled.addListener(check);
