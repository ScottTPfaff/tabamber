const DEFAULTS = {
  period: 60, whitelist: [], pinned: true, audio: true, paused: true, forms: true,
  idle_only: false, idle_timeout: 5, memory_enabled: false, memory_mb: 500, suspend_on_startup: false,
  // Phase 2: grouping
  auto_group: false, cluster_threshold: 0.35
};

const $ = id => document.getElementById(id);

chrome.storage.local.get(DEFAULTS, prefs => {
  $('period').value = prefs.period;
  $('whitelist').value = prefs.whitelist.join('\n');
  $('pinned').checked = prefs.pinned;
  $('audio').checked = prefs.audio;
  $('paused').checked = prefs.paused;
  $('forms').checked = prefs.forms;
  $('idle_only').checked = prefs.idle_only;
  $('idle_timeout').value = prefs.idle_timeout;
  $('memory_enabled').checked = prefs.memory_enabled;
  $('memory_mb').value = prefs.memory_mb;
  $('suspend_on_startup').checked = prefs.suspend_on_startup;
  // Phase 2
  $('auto_group').checked = prefs.auto_group;
  $('cluster_threshold').value = Math.round(prefs.cluster_threshold * 100);
});

$('save').addEventListener('click', () => {
  const prefs = {
    period: parseInt($('period').value) || 60,
    whitelist: $('whitelist').value.split('\n').map(s => s.trim()).filter(Boolean),
    pinned: $('pinned').checked,
    audio: $('audio').checked,
    paused: $('paused').checked,
    forms: $('forms').checked,
    idle_only: $('idle_only').checked,
    idle_timeout: parseInt($('idle_timeout').value) || 5,
    memory_enabled: $('memory_enabled').checked,
    memory_mb: parseInt($('memory_mb').value) || 500,
    suspend_on_startup: $('suspend_on_startup').checked,
    // Phase 2
    auto_group: $('auto_group').checked,
    cluster_threshold: (parseInt($('cluster_threshold').value) || 35) / 100,
  };
  chrome.storage.local.set(prefs, () => {
    const el = $('saved');
    el.style.display = 'inline';
    setTimeout(() => el.style.display = 'none', 2000);
  });
});
