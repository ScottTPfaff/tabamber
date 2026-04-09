# TabAmber 🟡

> *Your tabs, preserved in amber. Always there. Always ready.*

TabAmber is a browser extension that suspends inactive tabs to free memory — but the vision goes further: **suspended tabs become a living, searchable bookmark system**. Your open tabs represent intent and interest. TabAmber preserves that perfectly, like insects in amber, ready to wake the moment you need them.

The name comes from Ezekiel's vision — the wheel within a wheel, gleaming like amber. That's the architecture: tab groups within windows, suspended tabs within groups, intelligence within the extension.

---

## Why TabAmber is different

Every other tab suspender asks: *"how many tabs do you want?"*

TabAmber asks: *"how do you want your tabs organized?"*

You're not a person who has too many tabs. You're a person who uses tabs as a **visual, live, searchable second brain**. TabAmber is built for that workflow.

---

## Phase 1 — Time-Based Suspension ✅

- Suspends tabs inactive beyond a configurable time threshold (default: 60 min)
- No tab count limits — ever
- Never suspends: active tab, pinned tabs, audio tabs, tabs with unsaved forms, paused media
- Hostname whitelist — keep specific sites always live
- Memory guard — force-suspend any tab over X MB regardless of time
- Idle-only mode — only suspend when you step away from the keyboard
- Suspend on startup option
- Works in **Chrome and Firefox**
- Toolbar popup with instant controls + full settings page

---

## Phase 2 — Local Clustering & Tab Groups ✅

- **Auto Group** button in the popup — one click to organize all open tabs
- Scrapes only public categorization signals from each tab (og:type, og:site_name, keywords, description) — **no URLs, no titles, no personal data**
- Clusters tabs locally using keyword-frequency similarity — **no network call, no AI required**
- Creates native browser tab groups automatically with intelligent names
- Similarity threshold configurable (default: 35%) — higher = stricter grouping
- Group chips replace 20 tabs with 1 slot in your tab bar
- Click a group to expand — all tabs wake up

### How the clustering works

1. Reads public meta tags from every open tab
2. Computes pairwise similarity: site match (40%), type match (15%), section match (15%), keyword Jaccard overlap (30%)
3. Greedy agglomerative clustering merges tabs above the threshold
4. Groups are named from the dominant site or top keywords
5. Singleton tabs are collected into a "Miscellaneous" group

### Privacy

Only public meta tags are read. No URLs, no page titles, no user content ever leave the extension. Grouping runs entirely in the service worker.

---

## Phase 3 — AI Intelligence Layer ✅

Connects to your AI provider of choice for features that benefit from real intelligence. One endpoint, any model.

**Supported providers:**

- [Open WebUI](https://github.com/open-webui/open-webui) (recommended — one endpoint, 100+ models)
- Ollama (local, zero data leaves machine)
- OpenAI
- Anthropic
- Any OpenAI-compatible endpoint

### Features

- **Pruning suggestions** — "These 12 tabs are 47 days old and you have newer ones on the same topic. Prune?"
- **Usage habit analysis** — learns your patterns, suggests personalized suspension rules
- **Group name refinement** — better group names than raw keyword matching
- **Session digest** — end-of-day summary of your browsing threads
- **Anomaly detection** — memory hogs, zombie tabs, orphan tabs flagged for review

### Privacy model

**Only categorization signals are sent** — site category, content type, keywords. Never URLs, never tab titles, never user content. You control the data level:

- **Categories + keywords only** — most private, just topic signals
- **Include site names** — adds site context (e.g., "GitHub", "YouTube") for better analysis

API keys are **session-only** — stored in `chrome.storage.session`, cleared on browser close.

### Setup

1. Open TabAmber settings → AI Intelligence Layer
2. Enter your endpoint (e.g., `http://localhost:3000/api` for Open WebUI)
3. Click "Fetch Models" to populate the model dropdown
4. Enter your API key (session-only)
5. Toggle which AI features you want enabled

---

## Installation

### Chrome

1. `chrome://extensions/` → Enable Developer mode
2. "Load unpacked" → select the `tabamber/` directory

### Firefox

1. `about:debugging` → This Firefox → Load Temporary Add-on
2. Select `manifest.json`

---

## Project Structure

```
tabamber/
├── manifest.json          # Extension manifest (MV3)
├── sw.js                  # Service worker: suspension + clustering + AI routing
├── popup.html / .js       # Toolbar popup: quick controls + auto group + AI actions
├── options.html / .js     # Full settings page + AI connector config
├── inject/
│   ├── watch.js           # Tracks form input and last-visit time
│   ├── meta.js            # Reads tab state (audible, paused, forms, memory)
│   └── classify.js        # Scrapes public meta tags for categorization
└── lib/
    ├── cluster.js         # Local keyword-frequency clustering algorithm
    ├── ai-connector.js    # OpenAI-compatible API connector
    └── ai-prompts.js      # Prompt templates for all AI features
```

---

## Roadmap

- [x] Phase 1: time-based tab suspension
- [x] Phase 2: local tab clustering + group management
- [x] Phase 3: AI connector (Open WebUI / Ollama / OpenAI / Anthropic)
- [x] Phase 3: pruning suggestions
- [x] Phase 3: anomaly detection
- [x] Phase 3: session digest
- [ ] Phase 2: search across suspended tabs
- [ ] Phase 3: usage habit analysis + rule suggestions
- [ ] Phase 3: stale group archiving to bookmark folders

---

## Contributing

TabAmber is open source (MIT). PRs welcome. If you have ideas around the tab-as-bookmark workflow, open an issue — this project is actively evolving.

---

*Built by Scott Pfaff. Named for Ezekiel's vision — the wheel within a wheel, gleaming like amber.*
