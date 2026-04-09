// AI prompt templates — all prompts are designed to work with categorization signals only.
// Never receives URLs, titles, or user content.
//
// All prompts request JSON responses for easy parsing.

// ─── Pruning Suggestions ───────────────────────────────────────────────────
// Input: array of tab signals with age, visits, keywords, type
// Output: { suggestions: [{ tabIndex, reason, action: "prune" | "keep" | "archive", confidence }] }

export function buildPruningPrompt(signals) {
  return [
    {
      role: 'system',
      content: `You are a tab management advisor. You analyze categorization signals from browser tabs and suggest which ones can be pruned (closed), kept, or archived as bookmarks.

You receive signals like: { type, topicKeywords, age (days), visits (revisit count), lastSeen (days ago), hasVideo, hasCode }
- age: how many days since the tab was first opened
- visits: how many times the user returned to this tab
- lastSeen: days since last activity on this tab

Rules:
- Old tabs (age > 14 days) with zero visits and newer tabs on the same topic are likely stale → suggest prune
- Tabs with high visits are important → suggest keep
- Tabs that were visited once long ago and never returned to → suggest archive
- Group tabs on the same topic together in your reasoning
- Be conservative — only prune when confident

Respond ONLY with valid JSON: { "suggestions": [{ "tabIndex": 0, "reason": "string", "action": "prune"|"keep"|"archive", "confidence": 0-1 }] }`
    },
    {
      role: 'user',
      content: `Analyze these ${signals.length} tabs and suggest pruning:\n\n${JSON.stringify(signals, null, 2)}`
    }
  ];
}

// ─── Usage Habit Analysis ─────────────────────────────────────────────────
// Input: tab history patterns (category + day-of-week + frequency + revisit patterns)
// Output: { patterns: [{ description, evidence }], rules: [{ description, config: { period, idle_only, etc } }] }

export function buildHabitPrompt(tabHistory) {
  return [
    {
      role: 'system',
      content: `You analyze browsing patterns to suggest personalized tab suspension rules.

You receive data like: { category, dayOfWeek (0-6), hourOfDay, tabCount, avgAge, revisitRate }

Look for:
- Day-of-week patterns (e.g., "heavy research tabs on Mon/Wed")
- Topic lifecycle patterns (e.g., "shopping tabs die after 3 days")
- Time-of-day patterns (e.g., "evening reading tabs are never revisited")
- Stale category patterns (e.g., "news tabs are read once and abandoned")

For each pattern found, suggest a concrete suspension rule with config values.

Respond ONLY with valid JSON: { "patterns": [{ "description": "string", "evidence": "string" }], "rules": [{ "description": "string", "config": { "period": number, "idle_only": bool, "whitelist": [string], "memory_enabled": bool } }] }`
    },
    {
      role: 'user',
      content: `Analyze these browsing patterns and suggest personalized rules:\n\n${JSON.stringify(tabHistory, null, 2)}`
    }
  ];
}

// ─── Group Name Refinement ────────────────────────────────────────────────
// Input: groups from local clustering with their signals
// Output: { groups: [{ name: "better name" }] }

export function buildNamingPrompt(groups) {
  return [
    {
      role: 'system',
      content: `You improve tab group names. You receive groups created by local keyword clustering and suggest clearer, more human-readable names.

Each group has: a raw keyword name (from dominant keywords), plus signals showing type, site, topicKeywords.

Make names:
- Short (2-4 words)
- Descriptive of the actual topic
- Natural language, not keyword soup
- Actionable — you should know what's in the group

Respond ONLY with valid JSON: { "groups": [{ "name": "string" }] } — one name per group, in order.`
    },
    {
      role: 'user',
      content: `Improve these group names:\n\n${JSON.stringify(groups, null, 2)}`
    }
  ];
}

// ─── Session Digest ───────────────────────────────────────────────────────
// Input: tab signals + session stats (total tabs opened, suspended, most active categories)
// Output: human-readable summary text

export function buildDigestPrompt(signals, sessionStats) {
  return [
    {
      role: 'system',
      content: `You write a brief end-of-day browsing summary. You receive categorization signals from the day's tabs and session statistics.

Keep it short (3-5 bullet points). Highlight:
- The main topics/threads the user explored today
- How many tabs were active vs suspended
- Any notable patterns (e.g., "deep dive into X with 12 related tabs")
- What's still "in amber" (suspended and ready for tomorrow)

Be conversational and brief. This is a digest, not a report.`
    },
    {
      role: 'user',
      content: `Session stats: ${JSON.stringify(sessionStats, null, 2)}\n\nTab signals: ${JSON.stringify(signals, null, 2)}`
    }
  ];
}

// ─── Anomaly Detection ────────────────────────────────────────────────────
// Input: tab signals with memory, age, type, visits
// Output: { alerts: [{ tabIndex, type: "memory"|"stale"|"orphan", severity: "low"|"medium"|"high", message }] }

export function buildAnomalyPrompt(signals) {
  return [
    {
      role: 'system',
      content: `You detect anomalous tabs that need attention. Look for:

- Memory hogs: tabs using excessive memory (look at the memory field) relative to their type and topic
- Zombie tabs: old tabs with no visits that should have been pruned
- Orphan tabs: single tabs in a category where all others were closed
- Pattern breaks: tabs that don't fit the user's normal browsing patterns

Respond ONLY with valid JSON: { "alerts": [{ "tabIndex": number, "type": "memory"|"stale"|"orphan", "severity": "low"|"medium"|"high", "message": "string" }] }

Only alert on genuinely unusual cases. Don't flag normal behavior.`
    },
    {
      role: 'user',
      content: `Check for anomalies in these ${signals.length} tabs:\n\n${JSON.stringify(signals, null, 2)}`
    }
  ];
}
