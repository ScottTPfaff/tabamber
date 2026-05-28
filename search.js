const $ = id => document.getElementById(id);
let debounceTimer = null;

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const highlight = (text, query) => {
  if (!query) return esc(text);
  const safe = esc(text);
  const safeQ = esc(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safe.replace(new RegExp(`(${safeQ})`, 'gi'), '<mark class="highlight">$1</mark>');
};

const formatAge = (suspendedAt) => {
  const mins = Math.round((Date.now() - suspendedAt) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

const render = (results, query) => {
  const list = $('results');
  const empty = $('empty');

  if (!results.length) {
    list.innerHTML = '';
    empty.style.display = query ? 'block' : 'none';
    return;
  }

  empty.style.display = 'none';
  list.innerHTML = results.map(r => {
    const faviconUrl = `https://www.google.com/s2/favicons?domain=${esc(r.hostname)}&sz=16`;
    return `
      <li data-tab-id="${r.tabId}" data-url="${esc(r.url)}">
        <img class="favicon" src="${faviconUrl}" onerror="this.style.display='none'" alt="">
        <div class="info">
          <div class="title">${highlight(r.title, query)}</div>
          <div class="url">${highlight(r.url, query)}</div>
        </div>
        <div class="age">${esc(formatAge(r.suspendedAt))}</div>
      </li>`;
  }).join('');

  list.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', async () => {
      const tabId = parseInt(li.dataset.tabId);
      try {
        const tab = await chrome.tabs.update(tabId, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        window.close();
      } catch {
        // Tab may have been closed since the index was built — clean up
        li.remove();
        if (!$('results').children.length) {
          $('empty').style.display = 'block';
          $('empty').textContent = 'That tab no longer exists.';
        }
      }
    });
  });
};

const search = (query) => {
  if (!query.trim()) {
    $('results').innerHTML = '';
    $('empty').style.display = 'none';
    return;
  }
  chrome.runtime.sendMessage({ method: 'search-tabs', query }, resp => {
    if (resp?.ok) render(resp.results, query.trim());
  });
};

// Debounced input
$('query').addEventListener('input', e => {
  clearTimeout(debounceTimer);
  const q = e.target.value;
  debounceTimer = setTimeout(() => search(q), 200);
});

// Load stats for subtitle
const updateSubtitle = () => {
  chrome.runtime.sendMessage({ method: 'get-search-stats' }, resp => {
    if (resp?.ok) {
      $('subtitle').textContent =
        `${resp.suspended} suspended tab${resp.suspended !== 1 ? 's' : ''} of ${resp.total} total — click a result to wake it`;
    } else {
      $('subtitle').textContent = 'Type to search suspended tabs';
    }
  });
};

updateSubtitle();
$('query').focus();
