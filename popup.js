const DEFAULTS = {
  period: 60, pinned: true, audio: true, forms: true, idle_only: false
};
const $ = id => document.getElementById(id);

// ─── Diagnostics link ─────────────────────────────────────────────────────
$('diag-link').addEventListener('click', () => {
  chrome.tabs.create({ url: 'diagnostics.html' });
  window.close();
});

// ─── Error banner ─────────────────────────────────────────────────────────
const showErrors = () => {
  chrome.runtime.sendMessage({ method: 'get-critical' }, response => {
    const errors = response?.critical || [];
    if (errors.length === 0) {
      // Check badge count for warnings
      chrome.runtime.sendMessage({ method: 'get-health' }, hResp => {
        const h = hResp?.health;
        if (h && (h.discardErrors > 0 || h.injectErrors > 0 || h.aiErrors > 0)) {
          $('error-banner-container').innerHTML =
            `<div class="error-banner">⚠ ${h.discardErrors + h.injectErrors + h.aiErrors} recent errors. ` +
            `<a href="#" id="view-errors">View details</a>` +
            `</div>`;
          document.getElementById('view-errors')?.addEventListener('click', (e) => {
            e.preventDefault();
            chrome.tabs.create({ url: 'diagnostics.html' });
            window.close();
          });
        }
      });
      return;
    }
    $('error-banner-container').innerHTML = errors.map(e =>
      `<div class="error-banner">🔴 ${e.message} <span class="dismiss" data-ts="${e.ts}">✕</span></div>`
    ).join('');
    document.querySelectorAll('.dismiss').forEach(el => {
      el.addEventListener('click', () => {
        chrome.runtime.sendMessage({ method: 'clear-badge' }, () => {
          $('error-banner-container').innerHTML = '';
        });
      });
    });
  });
};
showErrors();

// ─── Phase 1/2: Settings ──────────────────────────────────────────────────

chrome.storage.local.get(DEFAULTS, prefs => {
  $('period').value = prefs.period;
  $('pinned').checked = prefs.pinned;
  $('audio').checked = prefs.audio;
  $('forms').checked = prefs.forms;
  $('idle_only').checked = prefs.idle_only;
  $('status').textContent = `Suspending tabs idle for ${prefs.period}+ min`;
});

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

// ─── Phase 2: Auto Group ──────────────────────────────────────────────────

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

const renderGroups = (groups) => {
  const container = $('group-status');
  if (!groups || groups.length === 0) {
    container.innerHTML = '';
    return;
  }
  let html = '<details><summary>Groups (' + groups.length + ')</summary>';
  for (const g of groups) {
    html += `<div class="group-chip">${g.title || g.group} <span class="count">(${g.tabCount || 0})</span></div>`;
  }
  html += '</details>';
  container.innerHTML = html;
};

chrome.runtime.sendMessage({ method: 'get-groups' }, response => {
  if (response?.groups) {
    renderGroups(response.groups.map(g => ({ title: g.title, tabCount: g.tabCount })));
  }
});

// ─── Phase 3: AI Features ─────────────────────────────────────────────────

// Check if AI is configured and show/hide section
chrome.storage.local.get({ ai_endpoint: '' }, prefs => {
  if (prefs.ai_endpoint) {
    $('ai-section').style.display = 'block';
  }
});

// Helper: get API key (session-only — prompt if not cached)
const getApiKey = () => new Promise(resolve => {
  chrome.storage.session.get({ ai_api_key: '' }, stored => {
    if (stored.ai_api_key) {
      resolve(stored.ai_api_key);
    } else {
      const key = prompt('Enter your AI API key (session-only, not saved):');
      if (key) {
        chrome.storage.session.set({ ai_api_key: key });
        resolve(key);
      } else {
        resolve(null);
      }
    }
  });
});

// Show AI result panel
const showAIResult = (content, isError) => {
  const panel = $('ai-result');
  panel.style.display = 'block';
  panel.style.color = isError ? '#c62828' : '#222';
  panel.style.whiteSpace = 'pre-wrap';
  panel.innerHTML = content;
};

// Pruning suggestions
$('ai-pruning').addEventListener('click', async () => {
  $('ai-pruning').textContent = '⏳ Analyzing...';
  $('ai-pruning').disabled = true;
  $('ai-result').style.display = 'none';

  const apiKey = await getApiKey();
  if (!apiKey) {
    $('ai-pruning').textContent = '🤖 Pruning Suggestions';
    $('ai-pruning').disabled = false;
    return;
  }

  chrome.runtime.sendMessage({ method: 'ai-pruning', apiKey }, response => {
    $('ai-pruning').textContent = '🤖 Pruning Suggestions';
    $('ai-pruning').disabled = false;

    if (response?.error) {
      showAIResult(`⚠ ${response.error}`, true);
    } else if (response?.suggestions?.length) {
      let html = '<strong>Pruning Suggestions:</strong><br>';
      for (const s of response.suggestions) {
        const icon = s.action === 'prune' ? '🗑' : s.action === 'archive' ? '📦' : '✅';
        html += `${icon} <strong>${s.action}</strong> — ${s.reason}<br>`;
      }
      showAIResult(html);
    } else {
      showAIResult('No pruning suggestions. All tabs look healthy.');
    }
  });
});

// Session digest
$('ai-digest').addEventListener('click', async () => {
  $('ai-digest').textContent = '⏳ Generating...';
  $('ai-digest').disabled = true;
  $('ai-result').style.display = 'none';

  const apiKey = await getApiKey();
  if (!apiKey) {
    $('ai-digest').textContent = '📋 Session Digest';
    $('ai-digest').disabled = false;
    return;
  }

  chrome.runtime.sendMessage({ method: 'ai-digest', apiKey, stats: {} }, response => {
    $('ai-digest').textContent = '📋 Session Digest';
    $('ai-digest').disabled = false;

    if (response?.error) {
      showAIResult(`⚠ ${response.error}`, true);
    } else if (response?.digest) {
      showAIResult(response.digest.replace(/\n/g, '<br>'));
    } else {
      showAIResult('No digest available.');
    }
  });
});

// Anomaly scan
$('ai-anomaly').addEventListener('click', async () => {
  $('ai-anomaly').textContent = '⏳ Scanning...';
  $('ai-anomaly').disabled = true;
  $('ai-result').style.display = 'none';

  const apiKey = await getApiKey();
  if (!apiKey) {
    $('ai-anomaly').textContent = '🔍 Anomaly Scan';
    $('ai-anomaly').disabled = false;
    return;
  }

  chrome.runtime.sendMessage({ method: 'ai-anomaly', apiKey }, response => {
    $('ai-anomaly').textContent = '🔍 Anomaly Scan';
    $('ai-anomaly').disabled = false;

    if (response?.error) {
      showAIResult(`⚠ ${response.error}`, true);
    } else if (response?.alerts?.length) {
      let html = '<strong>Anomaly Alerts:</strong><br>';
      for (const a of response.alerts) {
        const icon = a.severity === 'high' ? '🔴' : a.severity === 'medium' ? '🟡' : '🟢';
        html += `${icon} <strong>${a.type}</strong> — ${a.message}<br>`;
      }
      showAIResult(html);
    } else {
      showAIResult('✅ No anomalies detected. Everything looks normal.');
    }
  });
});

// ─── Common ───────────────────────────────────────────────────────────────

$('suspend-all').addEventListener('click', () => {
  chrome.runtime.sendMessage({ method: 'suspend-all' });
  window.close();
});

$('options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
