{
  const top = window.top === window;
  // Detect paused-but-cued media (so we don't discard a tab the user started watching)
  // https://github.com/rNeomy/auto-tab-discard/issues/315
  const paused = [...document.querySelectorAll('video,audio')].some(e => e.paused && e.currentTime);

  // Any non-paused <video>/<audio> in the page is a decent signal of "playing
  // media" even if the tab isn't technically emitting audio (chrome.tabs.audible
  // handles the actual audio case at the SW level). PiP alone is not a sensible
  // audio signal, so we stop relying on it here.
  const playingMedia = [...document.querySelectorAll('video,audio')]
    .some(e => !e.paused && !e.ended && e.readyState > 2);

  // Navigation timing replacement for the long-deprecated performance.timing.
  // Returns domContentLoadedEventStart as absolute ms since epoch, or 0.
  const navStart = (() => {
    try {
      const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
      if (nav) return performance.timeOrigin + nav.domContentLoadedEventStart;
    } catch { /* fall through */ }
    // Legacy fallback for very old engines
    return (performance.timing && performance.timing.domLoading) || 0;
  })();

  // Chrome-only; Firefox will leave memory === null, which disables the
  // memory-guard branch in the service worker (documented behavior).
  const memory = (performance && performance.memory)
    ? performance.memory.totalJSHeapSize
    : null;

  (top ? {
    time: window.lastVisit || navStart,
    audible: playingMedia,
    paused,
    permission: typeof Notification !== 'undefined' ? Notification.permission === 'granted' : false,
    ready: document.readyState === 'complete' || document.readyState === 'loaded',
    memory,
    forms: window.isReceivingFormInput || false
  } : {
    audible: playingMedia,
    paused,
    forms: window.isReceivingFormInput || false
  });
}
