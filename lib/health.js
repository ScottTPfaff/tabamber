// Health tracking — uptime, counters, last error.
// Persists across SW restarts via chrome.storage.session.
// Survives everything except full browser restart (intentionally).

const STORAGE_KEY = 'health_state';

let state = {
  startedAt: Date.now(),          // when SW was last started (ms)
  totalUptimeMs: 0,               // cumulative uptime across restarts (ms)
  tabsSuspended: 0,               // total tabs discarded
  tabsWoken: 0,                   // total tabs woken (undiscarded by user)
  groupsCreated: 0,               // total auto-group operations
  aiCalls: 0,                     // total AI API calls made
  aiErrors: 0,                    // AI call failures
  injectErrors: 0,                // script injection failures
  discardErrors: 0,               // tab discard failures
  lastError: null,                // most recent error object
  lastErrorAt: null,              // when it happened
};

// Load persisted state
const init = async () => {
  const stored = await new Promise(resolve =>
    chrome.storage.session.get({ [STORAGE_KEY]: null }, resolve)
  );
  if (stored[STORAGE_KEY]) {
    const prev = stored[STORAGE_KEY];
    // Preserve cumulative uptime
    if (prev.startedAt) {
      state.totalUptimeMs = prev.totalUptimeMs || 0;
    }
    // Carry forward all counters
    state.tabsSuspended = prev.tabsSuspended || 0;
    state.tabsWoken = prev.tabsWoken || 0;
    state.groupsCreated = prev.groupsCreated || 0;
    state.aiCalls = prev.aiCalls || 0;
    state.aiErrors = prev.aiErrors || 0;
    state.injectErrors = prev.injectErrors || 0;
    state.discardErrors = prev.discardErrors || 0;
    state.lastError = prev.lastError || null;
    state.lastErrorAt = prev.lastErrorAt || null;
  }
  state.startedAt = Date.now();
  persist();
};

const persist = () => {
  chrome.storage.session.set({ [STORAGE_KEY]: { ...state } });
};

// Format uptime into human string
const formatUptime = (ms) => {
  const totalSec = Math.floor(ms / 1000);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
};

// Get total uptime including previous sessions
const getTotalUptime = () => {
  const current = Date.now() - state.startedAt;
  return state.totalUptimeMs + current;
};

// Get snapshot
const snapshot = () => ({
  ...state,
  uptime: formatUptime(getTotalUptime()),
  uptimeMs: getTotalUptime(),
});

// Increment a counter
const inc = (key, by = 1) => {
  if (state[key] !== undefined) {
    state[key] += by;
    persist();
  }
};

// Record an error
const recordError = (message, code = 'UNKNOWN') => {
  state.lastError = { message, code };
  state.lastErrorAt = new Date().toISOString();
  persist();
};

const health = {
  init,
  snapshot,
  inc,
  recordError,
  formatUptime,
  getTotalUptime,
};

export default health;
