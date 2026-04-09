// Diagnostics page — log viewer + health dashboard.
// Communicates with the service worker via chrome.runtime.sendMessage.

const $ = id => document.getElementById(id);

// ─── Health Dashboard ──────────────────────────────────────────────────────

const renderHealth = (health) => {
  const cards = [
    { label: 'Uptime', value: health.uptime, cls: 'success' },
    { label: 'Tabs Suspended', value: health.tabsSuspended, cls: '' },
    { label: 'Tabs Woken', value: health.tabsWoken, cls: '' },
    { label: 'Groups Created', value: health.groupsCreated, cls: '' },
    { label: 'AI Calls', value: health.aiCalls, cls: '' },
    { label: 'AI Errors', value: health.aiErrors, cls: health.aiErrors > 0 ? 'error' : '' },
    { label: 'Inject Errors', value: health.injectErrors, cls: health.injectErrors > 0 ? 'error' : '' },
    { label: 'Discard Errors', value: health.discardErrors, cls: health.discardErrors > 0 ? 'error' : '' },
  ];

  $('health-grid').innerHTML = cards.map(c =>
    `<div class="card ${c.cls}"><div class="value">${c.value}</div><div class="label">${c.label}</div></div>`
  ).join('');

  if (health.lastError) {
    const errPanel = $('critical-panel');
    errPanel.innerHTML += `<div class="crit-entry">⚠ <strong>${health.lastError.code}</strong> — ${health.lastError.message} <span style="color:#888;font-size:11px;">(${health.lastErrorAt})</span></div>`;
  }
};

// ─── Critical Errors ──────────────────────────────────────────────────────

const renderCriticalErrors = (errors) => {
  if (!errors.length) {
    $('critical-panel').innerHTML = '<p style="color:#2e7d32;font-size:13px;">✅ No critical errors.</p>';
    return;
  }
  $('critical-panel').innerHTML = errors.map(e =>
    `<div class="crit-entry">🔴 ${e.message} <span style="color:#888;font-size:11px;">${e.ts}</span></div>`
  ).join('');
};

// ─── Log Viewer ────────────────────────────────────────────────────────────

let allLogs = [];

const renderLogs = () => {
  const levelFilter = $('filter-level').value;
  const textFilter = $('filter-text').value.toLowerCase();

  const levelOrder = { debug: 0, info: 1, warn: 2, error: 3 };
  const minLevel = levelOrder[levelFilter] ?? 0;

  const filtered = allLogs.filter(entry => {
    if (levelOrder[entry.level] < minLevel) return false;
    if (textFilter && !entry.message.toLowerCase().includes(textFilter)) return false;
    return true;
  });

  if (filtered.length === 0) {
    $('log-viewer').innerHTML = '<span style="color:#888;">No log entries match filters.</span>';
    return;
  }

  $('log-viewer').innerHTML = filtered.map(e => {
    const ts = e.ts ? e.ts.slice(11, 23) : ''; // just time portion
    const ctx = e.context ? ` ${JSON.stringify(e.context)}` : '';
    return `<div class="log-entry"><span class="ts">${ts}</span> <span class="level-${e.level}">[${e.level.toUpperCase()}]</span> <span class="msg">${escapeHtml(e.message)}</span><span class="ctx">${escapeHtml(ctx)}</span></div>`;
  }).join('');

  // Auto-scroll to bottom
  $('log-viewer').scrollTop = $('log-viewer').scrollHeight;
};

const escapeHtml = (str) => {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

// ─── Event Handlers ───────────────────────────────────────────────────────

$('refresh-logs').addEventListener('click', loadLogs);
$('filter-level').addEventListener('change', renderLogs);
$('filter-text').addEventListener('input', renderLogs);

$('clear-logs').addEventListener('click', () => {
  chrome.runtime.sendMessage({ method: 'clear-logs' }, () => {
    loadLogs();
  });
});

$('export-logs').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(allLogs, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tabamber-logs-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

// ─── Load ──────────────────────────────────────────────────────────────────

const loadLogs = () => {
  chrome.runtime.sendMessage({ method: 'get-logs' }, response => {
    allLogs = response?.entries || [];
    renderLogs();
  });

  chrome.runtime.sendMessage({ method: 'get-health' }, response => {
    if (response?.health) renderHealth(response.health);
  });

  chrome.runtime.sendMessage({ method: 'get-critical' }, response => {
    if (response) renderCriticalErrors(response.critical || []);
  });
};

loadLogs();
// Auto-refresh every 3 seconds
setInterval(loadLogs, 3000);
