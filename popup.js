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
    period: parseInt($('period').value) || 60,
    pinned: $('pinned').checked,
    audio: $('audio').checked,
    forms: $('forms').checked,
    idle_only: $('idle_only').checked,
  }, () => {
    $('status').textContent = `Suspending tabs idle for ${$('period').value}+ min`;
  });
};

['period', 'pinned', 'audio', 'forms', 'idle_only'].forEach(id =>
  $(id).addEventListener('change', save)
);

// Phase 2: Auto Group
$('auto-group').addEventListener('click', () => {
  $('auto-group').textContent = '⏳ Grouping...';
  $('auto-group').disabled = true;

  chrome.runtime.sendMessage({ method: 'auto-group' }, response => {
    if (response) {
      $('status').textContent = response.message;
      $('auto-group').textContent = '🔶 Auto Group Tabs';
      $('auto-group').disabled = false;
      renderGroups(response.groups || []);
    }
  });
});

// Render existing tab groups in the popup
const renderGroups = (groups) => {
  const container = $('group-status');
  if (!groups || groups.length === 0) {
    container.innerHTML = '';
    return;
  }

  let html = '<details><summary>Groups (' + groups.length + ')</summary>';
  for (const g of groups) {
    html += `<div class="group-chip">
      ${g.title || g.group}
      <span class="count">(${g.tabCount || 0})</span>
    </div>`;
  }
  html += '</details>';
  container.innerHTML = html;
};

// Load existing groups on popup open
chrome.runtime.sendMessage({ method: 'get-groups' }, response => {
  if (response?.groups) {
    renderGroups(response.groups.map(g => ({
      title: g.title,
      tabCount: g.tabCount
    })));
  }
});

$('suspend-all').addEventListener('click', () => {
  chrome.runtime.sendMessage({ method: 'suspend-all' });
  window.close();
});

$('options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
