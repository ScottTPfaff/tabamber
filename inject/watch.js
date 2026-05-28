/* Tracks whether the page is receiving unsaved form input, and the last
 * time the user looked at it. */

let checked = false;
const elements = new Set();

Object.defineProperty(window, 'isReceivingFormInput', {
  get() {
    try {
      if ([...elements].filter(e => e.isConnected && (e.value || e.textContent)).length === 0) {
        return false;
      }
    } catch { /* ignore */ }
    return checked;
  }
});

// Reset on submit
addEventListener('submit', () => {
  checked = false;
  elements.clear();
});

// A key press is "editing" if it produces a character, or is delete/backspace,
// or is part of IME composition. `e.path` is legacy WebKit; use composedPath().
const isEditingKey = (e) => {
  if (e.isComposing) return true;
  if (e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter' || e.key === 'Tab') return true;
  // Printable single-character keys (covers A–Z, digits, punctuation, and
  // non-Latin alphabets that emit a single grapheme on keydown).
  if (typeof e.key === 'string' && e.key.length === 1) return true;
  return false;
};

const markEditable = (el) => {
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) { elements.add(el); return true; }
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'FORM') {
    elements.add(el);
    return true;
  }
  if (el.type === 'application/pdf') return true;
  return false;
};

const onEdit = (e) => {
  if (!isEditingKey(e)) return;
  // Standard target
  if (markEditable(e.target)) { checked = true; }
  // Custom elements / shadow DOM — use the standard composedPath API
  if (typeof e.composedPath === 'function') {
    const path = e.composedPath();
    if (path && path.length && path[0] !== e.target && markEditable(path[0])) {
      checked = true;
    }
  }
};

// keydown catches character input and IME start; beforeinput catches paste,
// drag-drop, and voice/handwriting input that key events miss.
addEventListener('keydown', onEdit, true);
addEventListener('beforeinput', (e) => {
  if (markEditable(e.target)) checked = true;
}, true);
addEventListener('compositionstart', (e) => {
  if (markEditable(e.target)) checked = true;
}, true);

// Update last-visit time when the user looks at the tab.
addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    window.lastVisit = Date.now();
  }
});
