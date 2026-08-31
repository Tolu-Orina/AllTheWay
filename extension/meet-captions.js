/**
 * Meet captions and presenting, fail closed.
 *
 * Phase 3a: names only when Meet already labelled them. A caption region
 * without a name is not sent. Guessing from mixed text is how "Ada" appears
 * on someone else's sentence.
 *
 * Phase 2: presenting is reported so the side panel can stay closed and
 * insights can stay on the phone. The DOM strings Meet uses ("You're
 * presenting", "Stop presenting") are the probe; if they change, we fail
 * closed to "not presenting".
 */

const CAPTION_SEEN = new Set();

function isDisplayName(value) {
  const t = (value ?? "").trim();
  if (!t || t.length > 80) return false;
  if (t.includes("/")) return false;
  if (/[.!?]/.test(t)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 6) return false;
  return true;
}

function captionRegions() {
  const nodes = [
    ...document.querySelectorAll('[aria-label*="caption" i], [aria-label*="Caption"], [role="log"]'),
  ];
  return nodes.filter((el) => el instanceof HTMLElement);
}

/**
 * A labelled row is two parts Meet already split: a short name, then a
 * sentence. One blob of text is not a name.
 */
function labelledRows(root) {
  const found = [];
  const children = [...root.querySelectorAll("div, span, p, li")];
  for (const el of children) {
    if (!(el instanceof HTMLElement)) continue;
    const parts = [...el.childNodes]
      .map((node) => {
        if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").trim();
        if (node instanceof HTMLElement) return (node.innerText ?? "").trim();
        return "";
      })
      .filter(Boolean);
    if (parts.length < 2) continue;
    const speaker = parts[0];
    const text = parts.slice(1).join(" ").trim();
    if (!isDisplayName(speaker) || text.length < 8) continue;
    found.push({ speaker, text });
  }
  return found;
}

function harvestCaptions() {
  const rows = [];
  for (const region of captionRegions()) {
    rows.push(...labelledRows(region));
  }
  for (const row of rows) {
    const key = `${row.speaker}\0${row.text}`;
    if (CAPTION_SEEN.has(key)) continue;
    CAPTION_SEEN.add(key);
    if (CAPTION_SEEN.size > 80) {
      const first = CAPTION_SEEN.values().next().value;
      CAPTION_SEEN.delete(first);
    }
    chrome.runtime.sendMessage({ type: "meet-caption", speaker: row.speaker, text: row.text }, () => {
      void chrome.runtime.lastError;
    });
  }
}

function isPresenting() {
  const labelled = [...document.querySelectorAll("[aria-label], button, [role='button']")];
  for (const el of labelled) {
    const label = `${el.getAttribute("aria-label") ?? ""} ${el.textContent ?? ""}`;
    if (/stop presenting/i.test(label)) return true;
    if (/you(?:'|’)re presenting/i.test(label)) return true;
  }
  return false;
}

let lastPresenting = false;

function reportPresenting() {
  const presenting = isPresenting();
  if (presenting === lastPresenting) return;
  lastPresenting = presenting;
  chrome.runtime.sendMessage({ type: "meet-presenting", presenting }, () => {
    void chrome.runtime.lastError;
  });
}

const observer = new MutationObserver(() => {
  harvestCaptions();
  reportPresenting();
});

observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
harvestCaptions();
reportPresenting();
setInterval(() => {
  harvestCaptions();
  reportPresenting();
}, 2_000);
