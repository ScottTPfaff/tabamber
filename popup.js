const DEFAULTS = {
  period: 60, pinned: true, audio: true, forms: true, idle_only: false
};
const $ = id => document.getElementById(id);

// Load and display current settings
chrome.storage.local.get(DEFAULTS, prefs => {
  $('period').value = prefs.period;
  $('pinned').checked = prefs.pinned;
  $('audio').checked = prefs.audio;
  $('forms').checked = prefs.forms;
  $('idle_only').checked = prefs.idle_only;
  $('status').textContent = `Suspending tabs idle for ${prefs.period}+ min`;
});

// Save any toggle/field change immediately
const save = () => {
  chrome.storage.local.set({
    period:    parseInt($('period').value) || 60,
    pinned:    $('pinned').checked,
    audio:     $('audio').checked,
    forms:     $('forms').checked,
    idle_only: $('idle_only').checked,
  }, () => {
    $('status').textContent = `Suspending tabs idle for ${$('period').value}+ min`;
  });
};

['period', 'pinned', 'audio', 'forms', 'idle_only'].forEach(id =>
  $(id).addEventListener('change', save)
);

$('suspend-all').addEventListener('click', () => {
  chrome.runtime.sendMessage({ method: 'suspend-all' });
  window.close();
});

$('options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
