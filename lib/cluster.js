// Local tab clustering — no AI, no network.
// Groups tabs by site name first, then by keyword overlap.
// Returns: [{ group: string, tabIds: number[] }]

// Score how similar two tab classification signals are (0-1)
function similarity(a, b) {
  let score = 0;
  let weight = 0;

  // Same site is a strong signal
  if (a.site && b.site && a.site === b.site) {
    score += 0.4;
    weight += 0.4;
  } else if (a.site || b.site) {
    weight += 0.4; // different sites, no bonus
  }

  // Same type (article, product, video)
  if (a.type && b.type && a.type === b.type) {
    score += 0.15;
    weight += 0.15;
  } else if (a.type || b.type) {
    weight += 0.15;
  }

  // Same section (article:section)
  if (a.section && b.section && a.section === b.section) {
    score += 0.15;
    weight += 0.15;
  }

  // Keyword overlap — Jaccard similarity on topicKeywords
  if (a.topicKeywords.length > 0 && b.topicKeywords.length > 0) {
    const setA = new Set(a.topicKeywords);
    const setB = new Set(b.topicKeywords);
    const intersection = [...setA].filter(k => setB.has(k));
    const union = new Set([...setA, ...setB]);
    const jaccard = intersection.length / union.size;
    score += jaccard * 0.3;
    weight += 0.3;
  }

  return weight > 0 ? score / weight : 0;
}

// Generate a group name from the dominant signals in a cluster
function nameGroup(signals) {
  // Priority 1: dominant site name
  const siteCounts = {};
  const keywordCounts = {};

  for (const s of signals) {
    if (s.site) siteCounts[s.site] = (siteCounts[s.site] || 0) + 1;
    for (const k of (s.topicKeywords || [])) {
      keywordCounts[k] = (keywordCounts[k] || 0) + 1;
    }
  }

  // If most tabs share a site, use it
  const topSite = Object.entries(siteCounts).sort((a, b) => b[1] - a[1])[0];
  if (topSite && topSite[1] >= signals.length * 0.5) {
    const section = signals.find(s => s.section)?.section;
    return section ? `${topSite[0]} — ${section}` : topSite[0];
  }

  // Otherwise, name by top 2-3 keywords
  const topKeywords = Object.entries(keywordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);

  if (topKeywords.length > 0) {
    return topKeywords.map(k => k.charAt(0).toUpperCase() + k.slice(1)).join(' / ');
  }

  // Fallback
  const topType = signals.find(s => s.type)?.type;
  if (topType) return topType.charAt(0).toUpperCase() + topType.slice(1);

  return 'Miscellaneous';
}

// Simple agglomerative clustering: merge tabs with similarity >= threshold
export function clusterTabs(tabSignals, threshold = 0.35) {
  // tabSignals: [{ tabId, signal: {...} }]

  if (tabSignals.length === 0) return [];

  // Build similarity matrix, then greedily cluster
  const assignments = new Map(); // tabId -> clusterIndex
  const clusters = []; // [{ tabIds: number[], signals: object[] }]

  for (let i = 0; i < tabSignals.length; i++) {
    const { tabId: idA, signal: sigA } = tabSignals[i];

    // Find best existing cluster
    let bestCluster = -1;
    let bestScore = threshold;

    for (let c = 0; c < clusters.length; c++) {
      // Average similarity to all members of this cluster
      let avgSim = 0;
      for (const existingTabId of clusters[c].tabIds) {
        const existing = tabSignals.find(t => t.tabId === existingTabId);
        if (existing) {
          avgSim += similarity(sigA, existing.signal);
        }
      }
      avgSim /= clusters[c].tabIds.length;
      if (avgSim > bestScore) {
        bestScore = avgSim;
        bestCluster = c;
      }
    }

    if (bestCluster >= 0) {
      clusters[bestCluster].tabIds.push(idA);
      clusters[bestCluster].signals.push(sigA);
    } else {
      clusters.push({ tabIds: [idA], signals: [sigA] });
    }
  }

  // Merge tiny clusters (1 tab) into "Miscellaneous" unless they're alone
  const merged = [];
  const miscTabs = [];

  for (const cluster of clusters) {
    if (cluster.tabIds.length === 1) {
      miscTabs.push(cluster);
    } else {
      merged.push(cluster);
    }
  }

  // Combine singleton tabs into a Misc group if there are several
  if (miscTabs.length > 1) {
    merged.push({
      tabIds: miscTabs.flatMap(c => c.tabIds),
      signals: miscTabs.flatMap(c => c.signals)
    });
  } else if (miscTabs.length === 1) {
    merged.push(miscTabs[0]);
  }

  // Name each group and return
  return merged.map(cluster => ({
    group: nameGroup(cluster.signals),
    tabIds: cluster.tabIds
  }));
}

// Suspend all tabs in a group (except active, pinned, audio, etc.)
export async function suspendGroup(groupTabIds) {
  const tabs = await chrome.tabs.query({ discarded: false });
  const eligible = tabs.filter(t => groupTabIds.includes(t.id) && !t.active && !t.audible);

  for (const tab of eligible) {
    chrome.tabs.discard(tab.id, () => chrome.runtime.lastError);
  }
}

// Wake all tabs in a group (just focuses the first one, others wake on click)
export async function wakeGroup(groupTabIds) {
  const tabs = await chrome.tabs.query({});
  const groupTabs = tabs.filter(t => groupTabIds.includes(t.id));

  if (groupTabs.length > 0) {
    chrome.tabs.update(groupTabs[0].id, { active: true });
  }
}
