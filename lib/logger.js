// Structured logger — console + storage buffer + optional webhook stream.
// Zero config: works on load with console + storage.
// Auto-rotates last 100 entries in chrome.storage.local.
//
// Optional: set a local webhook URL to stream logs to VSCode Output panel.
//   chrome.storage.local.set({ log_webhook: 'http://localhost:7777/log' })

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
const MAX_ENTRIES = 100;
const STORAGE_KEY = 'log_entries';

// Runtime config (can be overridden from storage)
let config = {
  level: 'info',            // debug | info | warn | error | silent
  webhook: '',              // optional POST URL for log streaming
  maxEntries: MAX_ENTRIES,
};

// In-memory circular buffer (fast, no storage reads for writes)
let buffer = [];

// Load config from storage on init
const init = async () => {
  const stored = await new Promise(resolve =>
    chrome.storage.local.get({ log_level: 'info', log_webhook: '', log_max_entries: MAX_ENTRIES }, resolve)
  );
  config.level = stored.log_level;
  config.webhook = stored.log_webhook;
  config.maxEntries = stored.log_max_entries || MAX_ENTRIES;

  // Load persisted entries
  const logStored = await new Promise(resolve =>
    chrome.storage.local.get({ [STORAGE_KEY]: [] }, resolve)
  );
  buffer = logStored[STORAGE_KEY] || [];
};

// Internal: write one log entry
const write = async (level, message, context = {}) => {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    context: Object.keys(context).length > 0 ? context : undefined,
  };

  buffer.push(entry);

  // Rotate
  while (buffer.length > config.maxEntries) {
    buffer.shift();
  }

  // Persist (debounced: only keep last N)
  chrome.storage.local.set({ [STORAGE_KEY]: buffer.slice(-config.maxEntries) });

  // Console (always, if level permits)
  const consoleFn = {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  }[level] || console.log;

  const ctxStr = context && Object.keys(context).length ? JSON.stringify(context) : '';
  const prefix = `[TabAmber ${level.toUpperCase()}]`;
  consoleFn(`${prefix} ${message}`, ctxStr);

  // Webhook (fire and forget)
  if (config.webhook) {
    try {
      fetch(config.webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
        keepalive: true,
      }).catch(() => {}); // webhook down is not our problem
    } catch {}
  }
};

// Public API
const log = {
  init,
  debug: (msg, ctx) => { if (LOG_LEVELS[config.level] <= LOG_LEVELS.debug) write('debug', msg, ctx); },
  info:  (msg, ctx) => { if (LOG_LEVELS[config.level] <= LOG_LEVELS.info)  write('info', msg, ctx); },
  warn:  (msg, ctx) => { if (LOG_LEVELS[config.level] <= LOG_LEVELS.warn)  write('warn', msg, ctx); },
  error: (msg, ctx) => { if (LOG_LEVELS[config.level] <= LOG_LEVELS.error) write('error', msg, ctx); },

  // Get all buffered entries (for diagnostics page)
  getEntries: () => [...buffer],

  // Clear buffer
  clear: async () => {
    buffer = [];
    chrome.storage.local.remove(STORAGE_KEY);
  },

  // Update config at runtime
  setConfig: (newConfig) => {
    if (newConfig.level && LOG_LEVELS[newConfig.level] !== undefined) config.level = newConfig.level;
    if (newConfig.webhook !== undefined) config.webhook = newConfig.webhook;
    if (newConfig.maxEntries) config.maxEntries = newConfig.maxEntries;
    chrome.storage.local.set({
      log_level: config.level,
      log_webhook: config.webhook,
      log_max_entries: config.maxEntries,
    });
  },

  // Get current config
  getConfig: () => ({ ...config }),
};

export default log;
