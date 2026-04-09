// 3-tier notification system:
//   info   → popup status text (no badge, no Chrome notification)
//   warn   → badge count on extension icon
//   error  → Chrome persistent notification
//   critical → Chrome notification + badge + blocks popup until acknowledged
//
// All notification state survives SW restarts via chrome.storage.session.

import log from './logger.js';

const STORAGE_KEY = 'notification_badge_count';
const CRITICAL_KEY = 'critical_errors';

let badgeCount = 0;
let criticalErrors = [];

// Restore state on init
const init = async () => {
  const stored = await new Promise(resolve =>
    chrome.storage.session.get({ [STORAGE_KEY]: 0, [CRITICAL_KEY]: [] }, resolve)
  );
  badgeCount = stored[STORAGE_KEY] || 0;
  criticalErrors = stored[CRITICAL_KEY] || [];

  // Restore config
  const config = await new Promise(resolve =>
    chrome.storage.local.get({ notif_badge: true, notif_chrome: true, notif_sounds: false }, resolve)
  );
  Object.assign(notifier.config, config);

  updateBadge();
};

const notifierConfig = {
  notif_badge: true,   // show badge on icon
  notif_chrome: true,  // show Chrome notifications
  notif_sounds: false, // play sound on error (future)
};

// Update the badge count
const updateBadge = () => {
  if (!notifierConfig.notif_badge) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  if (badgeCount > 0) {
    chrome.action.setBadgeText({ text: badgeCount > 99 ? '99+' : String(badgeCount) });
    chrome.action.setBadgeBackgroundColor({ color: badgeCount > 5 ? '#d32f2f' : '#f57c00' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
};

// Show a Chrome notification
const showChromeNotification = (title, message, priority = 'normal') => {
  if (!notifierConfig.notif_chrome) return;

  // Simple amber circle as base64 PNG (48x48)
  const iconData = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><circle cx="24" cy="24" r="20" fill="#d4a017"/><circle cx="24" cy="24" r="14" fill="#f0c040"/><circle cx="24" cy="24" r="6" fill="#b8920f"/></svg>'
  );

  chrome.notifications.create({
    type: 'basic',
    iconUrl: iconData,
    title: `TabAmber: ${title}`,
    message,
    priority: priority === 'critical' ? 2 : 0,
    isClickable: true,
  });
};

// Handle notification click → open diagnostics
chrome.notifications.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage?.();
  // Or open diagnostics tab directly:
  chrome.tabs.create?.({ url: 'diagnostics.html' });
});

const notifier = {
  config: notifierConfig,
  init,

  // Info — popup only, no badge
  info: (message) => {
    log.info(message);
    // Just logging — popup status handles display
  },

  // Warning — badge increment
  warn: (message, context = {}) => {
    badgeCount++;
    chrome.storage.session.set({ [STORAGE_KEY]: badgeCount });
    updateBadge();
    log.warn(message, context);
  },

  // Error — Chrome notification + badge
  error: (message, context = {}) => {
    badgeCount++;
    chrome.storage.session.set({ [STORAGE_KEY]: badgeCount });
    updateBadge();
    log.error(message, context);
    showChromeNotification('Error', message, 'normal');
  },

  // Critical — Chrome notification (persistent) + badge + stored
  critical: (message, context = {}) => {
    badgeCount += 3; // bigger impact
    chrome.storage.session.set({ [STORAGE_KEY]: badgeCount });
    updateBadge();
    log.error(`[CRITICAL] ${message}`, context);

    const entry = { ts: new Date().toISOString(), message, context };
    criticalErrors.push(entry);
    chrome.storage.session.set({ [CRITICAL_KEY]: criticalErrors.slice(-10) });

    showChromeNotification('Critical Error', message + ' — Click to view details', 'critical');
  },

  // Get current badge count
  getBadgeCount: () => badgeCount,

  // Clear badge and all pending notifications
  clearBadge: async () => {
    badgeCount = 0;
    chrome.storage.session.set({ [STORAGE_KEY]: 0, [CRITICAL_KEY]: [] });
    criticalErrors = [];
    updateBadge();
  },

  // Get critical errors (for diagnostics page)
  getCriticalErrors: () => [...criticalErrors],

  // Reset configuration
  setConfig: (newConfig) => {
    Object.assign(notifierConfig, newConfig);
    chrome.storage.local.set({
      notif_badge: notifierConfig.notif_badge,
      notif_chrome: notifierConfig.notif_chrome,
      notif_sounds: notifierConfig.notif_sounds,
    });
    updateBadge();
  },
};

export default notifier;
