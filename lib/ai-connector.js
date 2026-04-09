// AI connector — talks to any OpenAI-compatible API endpoint.
// Designed for Open WebUI (one endpoint, 100+ models) but works with any provider.
//
// Privacy: only categorization signals are ever sent. Never URLs, titles, or user content.

const DEFAULT_AI_CONFIG = {
  endpoint: '',           // e.g. http://localhost:3000/api
  apiKey: '',             // stored in memory only (session), not persisted
  model: '',              // selected from /api/models
  features: {
    pruning: true,
    habit_analysis: false,
    group_naming: true,
    session_digest: false,
    anomaly_alerts: false,
  },
  data_level: 'categories_only', // 'categories_only' | 'include_site_name'
};

// Load AI config from storage (minus API key — that's session-only)
export const getAIConfig = async () => {
  const stored = await new Promise(resolve =>
    chrome.storage.local.get({ ai_endpoint: '', ai_model: '', ai_features: DEFAULT_AI_CONFIG.features, ai_data_level: 'categories_only' }, resolve)
  );
  return {
    endpoint: stored.ai_endpoint,
    apiKey: '', // never read from storage — must be entered each session
    model: stored.ai_model,
    features: stored.ai_features,
    data_level: stored.ai_data_level,
  };
};

// Save AI config (endpoint, model, features — never API key)
export const saveAIConfig = async (config) => {
  return new Promise(resolve =>
    chrome.storage.local.set({
      ai_endpoint: config.endpoint,
      ai_model: config.model,
      ai_features: config.features,
      ai_data_level: config.data_level,
    }, resolve)
  );
};

// Fetch available models from the endpoint
export const fetchModels = async (endpoint, apiKey) => {
  if (!endpoint) return [];
  try {
    const res = await fetch(`${endpoint}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    if (!res.ok) return [];
    const data = await res.json();
    // OpenAI-compatible: { data: [{ id: '...' }, ...] } or just [{ id: '...' }, ...]
    const models = data.data || data;
    return Array.isArray(models) ? models.map(m => m.id || m) : [];
  } catch {
    return [];
  }
};

// Core chat completion call — works with any OpenAI-compatible API
const chatComplete = async (config, messages, options = {}) => {
  const { endpoint, apiKey, model } = config;
  if (!endpoint || !model) throw new Error('AI endpoint or model not configured');

  const res = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 1024,
      ...(options.json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`AI API error (${res.status}): ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
};

// Strip categorization signals down to only what the AI should see
const sanitizeSignals = (signals, dataLevel) => {
  return signals.map(s => {
    const safe = { type: s.signal.type };
    if (dataLevel === 'include_site_name') {
      safe.site = s.signal.site;
      safe.section = s.signal.section;
    }
    safe.topicKeywords = s.signal.topicKeywords;
    safe.descSnippet = s.signal.descSnippet;
    safe.lang = s.signal.lang;
    safe.hasVideo = s.signal.hasVideo;
    safe.hasCode = s.signal.hasCode;
    // Include metadata we track locally (not from the page content)
    safe.age = s.age;              // days since first opened
    safe.visits = s.visits;        // how many times revisited
    safe.lastSeen = s.lastSeen;    // last activity timestamp
    safe.memory = s.memory;        // current memory usage
    return safe;
  });
};

// ─── AI Feature Functions ──────────────────────────────────────────────────

import { buildPruningPrompt, buildHabitPrompt, buildNamingPrompt, buildDigestPrompt, buildAnomalyPrompt } from './ai-prompts.js';

// Pruning suggestions
export const getPruningSuggestions = async (config, tabSignals) => {
  if (!config.features.pruning) return null;

  const signals = sanitizeSignals(tabSignals, config.dataLevel);
  const messages = buildPruningPrompt(signals);

  const result = await chatComplete(config, messages, { json: true });
  try {
    return JSON.parse(result);
  } catch {
    return { suggestions: [], reason: 'AI response was not valid JSON' };
  }
};

// Usage habit analysis
export const getHabitAnalysis = async (config, tabHistory) => {
  if (!config.features.habit_analysis) return null;

  const messages = buildHabitPrompt(tabHistory);
  const result = await chatComplete(config, messages, { json: true, maxTokens: 2048 });
  try {
    return JSON.parse(result);
  } catch {
    return { patterns: [], rules: [], reason: 'AI response was not valid JSON' };
  }
};

// Refine group names from local clustering
export const refineGroupNames = async (config, groups) => {
  if (!config.features.group_naming) return groups;

  const messages = buildNamingPrompt(groups);
  const result = await chatComplete(config, messages, { json: true });
  try {
    const refined = JSON.parse(result);
    // Merge refined names back into groups
    return groups.map((g, i) => ({
      ...g,
      name: refined?.groups?.[i]?.name || g.name,
      nameLocal: g.name,  // keep the original
      nameRefinedByAI: refined?.groups?.[i]?.name || null,
    }));
  } catch {
    return groups;
  }
};

// Session digest
export const getSessionDigest = async (config, tabSignals, sessionStats) => {
  if (!config.features.session_digest) return null;

  const signals = sanitizeSignals(tabSignals, config.dataLevel);
  const messages = buildDigestPrompt(signals, sessionStats);
  const result = await chatComplete(config, messages, { maxTokens: 1024 });
  return result;
};

// Anomaly detection
export const getAnomalyAlerts = async (config, tabSignals) => {
  if (!config.features.anomaly_alerts) return null;

  const signals = sanitizeSignals(tabSignals, config.dataLevel);
  const messages = buildAnomalyPrompt(signals);
  const result = await chatComplete(config, messages, { json: true });
  try {
    return JSON.parse(result);
  } catch {
    return { alerts: [] };
  }
};
