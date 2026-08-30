/**
 * The insight panel.
 *
 * ## Why a side panel and not the popup
 *
 * A popup closes the moment you click anything else — which, in a meeting, is
 * immediately. The side panel persists beside the tab, which is the only place
 * something glanceable can actually live.
 *
 * ## Quiet by construction
 *
 * No sound, no badge, no animation, and nothing appears unless it clears the
 * bar. An insight has to be worth more than the sentence you miss reading it,
 * and a panel that updates constantly is a panel people close.
 *
 * ## Sources, always
 *
 * Each insight names where it came from. An uncited claim during a live
 * negotiation is precisely the confident-and-wrong failure this product spends
 * so much effort avoiding, and it is worse here because someone may act on it
 * within the minute.
 */

const list = document.getElementById("insights");
const now = document.getElementById("now");
const liveSection = document.getElementById("live-section");
const liveText = document.getElementById("live-text");

function render(insights) {
  if (!insights.length) return;

  // Newest first: in a meeting, the thing that just became true matters more
  // than the thing that was true ten minutes ago.
  const existing = list.querySelector(".empty");
  if (existing) existing.remove();

  for (const insight of insights) {
    const el = document.createElement("div");
    el.className = `insight ${insight.kind}`;

    const kind = document.createElement("p");
    kind.className = "kind";
    kind.textContent = {
      contradiction: "Disagrees with your documents",
      context: "Worth knowing",
      unanswered: "Nobody answered this",
    }[insight.kind] ?? "Worth knowing";

    const text = document.createElement("p");
    text.className = "text";
    // textContent, never innerHTML: this string originates in a meeting
    // transcript by way of a model, and neither is a source to trust with markup.
    text.textContent = insight.text;

    el.append(kind, text);

    for (const source of insight.sources ?? []) {
      const src = document.createElement("p");
      src.className = "src";
      if (source.kind === "web" && source.locator) {
        const a = document.createElement("a");
        a.href = source.locator;
        a.target = "_blank";
        a.rel = "noreferrer noopener";
        a.textContent = source.title || source.locator;
        src.append("Source: ", a);
      } else {
        src.textContent = `Your documents: ${source.title}${source.locator ? ` ${source.locator}` : ""}`;
      }
      el.append(src);
    }

    list.prepend(el);
  }
}

now.addEventListener("click", () => {
  // The schedule widens as a meeting settles, so the moment somebody wants a
  // check is exactly when the next scheduled pass is furthest away.
  void chrome.runtime.sendMessage({ type: "insights-now" });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "insights" && Array.isArray(message.insights)) {
    render(message.insights);
  }
  if (message?.type === "transcript" && typeof message.text === "string") {
    liveSection.hidden = false;
    // Keep only the last ~200 chars so the box stays glanceable.
    const combined = `${liveText.textContent}${message.text} `;
    liveText.textContent = combined.slice(-200);
  }
  return false;
});
