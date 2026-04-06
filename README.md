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

## Phase 1 — Time-Based Suspension (current)

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

## Phase 2 — Local Clustering & Tab Groups (coming)

- Scrapes categorization signals from each tab (og:type, og:site_name, keywords, description)
- Clusters tabs locally by topic using keyword frequency — no network call, no AI required
- Creates Chrome/Firefox tab groups automatically
- Suspend entire groups as a single unit — one group chip instead of 20 tabs
- Wake an entire group with one click

**Privacy:** only public meta tags are read. No URLs, no titles, no user content leave the extension.

---

## Phase 3 — AI Intelligence Layer (coming)

Connects to your AI provider of choice for features that benefit from real intelligence:

- **Pruning suggestions** — "These 12 tabs are 47 days old and you have newer ones on the same topic. Prune?"
- **Usage habit analysis** — learns your patterns, suggests personalized suspension rules
- **Group name refinement** — better group names than raw keyword matching
- **Session digest** — end-of-day summary of your browsing threads
- **Stale group detection** — archive or delete groups you haven't touched in weeks

**Supported providers:**
- [Open WebUI](https://github.com/open-webui/open-webui) (recommended — one endpoint, 100+ models)
- Ollama (local, zero data leaves machine)
- OpenAI
- Anthropic
- Any OpenAI-compatible endpoint

**Privacy model:** only categorization signals are sent (site category, content type, keywords). Never URLs, never tab titles, never user content.

---

## Installation

### Chrome
1. `chrome://extensions/` → Enable Developer mode
2. "Load unpacked" → select the `tabamber/` directory

### Firefox
1. `about:debugging` → This Firefox → Load Temporary Add-on
2. Select `manifest.json`

---

## Roadmap

- [ ] Phase 2: local tab clustering + group management
- [ ] Phase 2: group-level suspend/wake
- [ ] Phase 2: search across suspended tabs
- [ ] Phase 3: AI connector (Open WebUI / Ollama / OpenAI / Anthropic)
- [ ] Phase 3: pruning suggestions
- [ ] Phase 3: usage habit analysis + rule suggestions
- [ ] Phase 3: session digest
- [ ] Phase 3: stale group archiving to bookmark folders

---

## Contributing

TabAmber is open source (MIT). PRs welcome. If you have ideas around the tab-as-bookmark workflow, open an issue — this project is actively evolving.

---

*Built by Scott Pfaff. Named for Ezekiel's vision — the wheel within a wheel, gleaming like amber.*
