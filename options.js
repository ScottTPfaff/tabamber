const DEFAULTS = {
  period: 60, whitelist: [], pinned: true, audio: true, paused: true, forms: true,
  idle_only: false, idle_timeout: 5, memory_enabled: false, memory_mb: 500, suspend_on_startup: false,
  // Phase 2: grouping
  auto_group: false, cluster_threshold: 0.35,
  // Phase 3: AI
  ai_endpoint: '', ai_model: '',
  ai_features: { pruning: true, habit_analysis: false, group_naming: true, session_digest: false, anomaly_alerts: false },
  ai_data_level: 'categories_only',
};

const $ = id => document.getElementById(id);

// ─── Load all settings ───────────────────────────────────────────────────

chrome.storage.local.get(DEFAULTS, prefs => {
  // Phase 1
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
  // Phase 3: AI
  if (prefs.ai_endpoint) {
    $('ai_endpoint').value = prefs.ai_endpoint;
    updateConnectionStatus('connected');
  }
  if (prefs.ai_model) {
    $('ai_model').value = prefs.ai_model;
    populateModelDropdown(prefs.ai_model);
  }
  if (prefs.ai_features) {
    $('ai_pruning').checked = prefs.ai_features.pruning ?? true;
    $('ai_habit').checked = prefs.ai_features.habit_analysis ?? false;
    $('ai_naming').checked = prefs.ai_features.group_naming ?? true;
    $('ai_digest').checked = prefs.ai_features.session_digest ?? false;
    $('ai_anomaly').checked = prefs.ai_features.anomaly_alerts ?? false;
  }
  // Data level radio
  const dataLevelRadio = document.querySelector(`input[name="ai_data_level"][value="${prefs.ai_data_level}"]`);
  if (dataLevelRadio) dataLevelRadio.checked = true;
});

// ─── AI: Fetch models ─────────────────────────────────────────────────────

const populateModelDropdown = (selectedModel) => {
  const endpoint = $('ai_endpoint').value.trim();
  const apiKey = $('ai_api_key').value.trim();
  if (!endpoint) return;

  $('ai_fetch_models').disabled = true;
  $('ai_fetch_models').textContent = 'Loading...';

  chrome.runtime.sendMessage({
    method: 'ai-fetch-models',
    endpoint,
    apiKey
  }, response => {
    $('ai_fetch_models').disabled = false;
    $('ai_fetch_models').textContent = 'Fetch Models';

    if (response?.models?.length) {
      $('ai_model').innerHTML = response.models.map(m =>
        `<option value="${m}" ${m === selectedModel ? 'selected' : ''}>${m}</option>`
      ).join('');
      updateConnectionStatus('connected');
    } else {
      $('ai_model').innerHTML = '<option value="">No models found</option>';
      updateConnectionStatus('disconnected');
    }
  });
};

$('ai_fetch_models').addEventListener('click', () => populateModelDropdown(''));

const updateConnectionStatus = (status) => {
  const el = $('ai_status');
  el.className = `ai-status ${status}`;
  el.textContent = status === 'connected' ? '✓ Connected' : '✗ Not connected';
};

// ─── Save ─────────────────────────────────────────────────────────────────

$('save').addEventListener('click', () => {
  const aiFeatures = {
    pruning: $('ai_pruning').checked,
    habit_analysis: $('ai_habit').checked,
    group_naming: $('ai_naming').checked,
    session_digest: $('ai_digest').checked,
    anomaly_alerts: $('ai_anomaly').checked,
  };

  const aiDataLevel = document.querySelector('input[name="ai_data_level"]:checked')?.value || 'categories_only';

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
    // Phase 3: AI (never saves API key)
    ai_endpoint: $('ai_endpoint').value.trim(),
    ai_model: $('ai_model').value,
    ai_features: aiFeatures,
    ai_data_level: aiDataLevel,
  };

  chrome.storage.local.set(prefs, () => {
    const el = $('saved');
    el.style.display = 'inline';
    setTimeout(() => el.style.display = 'none', 2000);
  });
});
