// Scrapes only public categorization signals from a tab.
// No URL, no title, no user content — just what the site declares about itself.
// Returns a flat signal object the service worker uses for local clustering.

(() => {
  const get = (selector, attr) => {
    const el = document.querySelector(selector);
    return el ? el.getAttribute(attr) : null;
  };

  const ogType        = get('meta[property="og:type"]', 'content');
  const ogSiteName    = get('meta[property="og:site_name"]', 'content');
  const ogTitle       = get('meta[property="og:title"]', 'content');
  const keywords      = get('meta[name="keywords"]', 'content');
  const description   = get('meta[name="description"]', 'content');
  const articleSection = get('meta[name="article:section"]', 'content');
  const articleTag    = get('meta[name="article:tag"]', 'content');

  // Derive a short topic signal from dominant keywords
  const topicKeywords = [];
  if (keywords) {
    keywords.split(',').slice(0, 5).map(k => k.trim().toLowerCase()).filter(Boolean).forEach(k => {
      if (!topicKeywords.includes(k)) topicKeywords.push(k);
    });
  }
  // Fallback: extract from article tags
  if (topicKeywords.length === 0 && articleTag) {
    articleTag.split(',').slice(0, 5).map(k => k.trim().toLowerCase()).filter(Boolean).forEach(k => {
      if (!topicKeywords.includes(k)) topicKeywords.push(k);
    });
  }

  return {
    type:           ogType || null,           // "article", "product", "video", "website"
    site:           ogSiteName || null,       // "GitHub", "YouTube", "Amazon"
    section:        articleSection || null,   // "Technology", "Science"
    topicKeywords,                            // ["python", "machine learning", "tutorial"]
    descSnippet:    description ? description.slice(0, 80) : null,  // first 80 chars only
    hasVideo:       document.querySelectorAll('video').length > 0,
    hasCode:        document.querySelectorAll('pre, code').length > 2,
    isDoc:          document.contentType === 'application/pdf',
    lang:           document.documentElement.lang || 'en',
    ready:          document.readyState === 'complete' || document.readyState === 'loaded'
  };
})();
