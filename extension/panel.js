/**
 * The side panel is the product: start, stop, the transcript, and Check now.
 *
 * A popup closes the moment you click the meeting. This stays beside it.
 * Disclosure is never remembered — "I told them" is true of one meeting.
 */

import { ensureGatewayAccess, findMeetingTab } from "./meeting-tab.js";

const LINES_KEY = "transcriptLines";
const INSIGHTS_KEY = "insightCards";
const GATEWAY_KEY = "gateway";
const MAX_LINES = 500;

const disclosed = document.getElementById("disclosed");
const discloseBlock = document.getElementById("disclose-block");
const toggle = document.getElementById("toggle");
const status = document.getElementById("status");
const error = document.getElementById("error");
const linesEl = document.getElementById("lines");
const linesEmpty = document.getElementById("lines-empty");
const list = document.getElementById("insights");
const now = document.getElementById("now");
const insightStatus = document.getElementById("insight-status");
const hideWhilePresenting = document.getElementById("hide-while-presenting");
const insightsSection = document.getElementById("insights-section");
const botDisclosed = document.getElementById("bot-disclosed");
const sendBot = document.getElementById("send-bot");
const botStatus = document.getElementById("bot-status");

const TOKEN_KEY = "idToken";
const HIDE_INSIGHTS_KEY = "hideInsightsWhilePresenting";

/** @type {{ tabId: number, meetingId: string, startedAt: number } | null} */
let capturing = null;
/** @type {{ text: string, at?: string, finished: boolean, speaker?: string }[]} */
let lines = [];
/** @type {object[]} */
let insightCards = [];
let checking = false;
let presenting = false;
let hideInsightsPref = true;

const QUIET = {
  too_little: "Not enough spoken yet. Try again after a bit more of the meeting.",
  metered: "Live checks are on Team and Max, or this month's allowance is used.",
  screened: "Nothing to show from that pass.",
  unavailable: "Could not run a check just now.",
  none: "Nothing to add. Silence is normal.",
};

function show(message) {
  error.hidden = !message;
  error.textContent = message ?? "";
}

function pinnedToNewest() {
  return linesEl.scrollHeight - linesEl.scrollTop - linesEl.clientHeight < 40;
}

function renderLines() {
  const pin = pinnedToNewest();
  linesEmpty.hidden = lines.length > 0;

  for (const child of [...linesEl.querySelectorAll(".line")]) child.remove();

  for (const line of lines) {
    const el = document.createElement("p");
    el.className = line.finished ? "line" : "line interim";
    if (line.finished) {
      const who = document.createElement("span");
      who.className = "who";
      who.textContent = line.speaker && String(line.speaker).trim() ? line.speaker : "Unattributed";
      el.append(who);
    }
    el.append(document.createTextNode(line.text));
    linesEl.append(el);
  }

  if (pin || !lines.length) linesEl.scrollTop = linesEl.scrollHeight;
}

function persistLines() {
  void chrome.storage.session.set({ [LINES_KEY]: lines.slice(-MAX_LINES) });
}

function applyTranscript({ text, at, finished, speaker }) {
  if (typeof text !== "string" || !text) return;

  if (finished) {
    if (lines.length && !lines[lines.length - 1].finished) lines.pop();
    lines.push({ text, at, finished: true, speaker });
    const finishedCount = lines.filter((line) => line.finished).length;
    if (finishedCount > MAX_LINES) {
      const extra = finishedCount - MAX_LINES;
      let dropped = 0;
      lines = lines.filter((line) => {
        if (line.finished && dropped < extra) {
          dropped += 1;
          return false;
        }
        return true;
      });
    }
  } else if (lines.length && !lines[lines.length - 1].finished) {
    lines[lines.length - 1] = { text, at, finished: false };
  } else {
    lines.push({ text, at, finished: false });
  }

  persistLines();
  renderLines();
}

function paintPrivateInsights() {
  const hide = hideInsightsPref && presenting;
  insightsSection.hidden = hide;
  if (hide) {
    setInsightStatus("Presenting — insights are on your phone, not on this screen.");
  }
}

function paintInsights() {
  if (!insightCards.length) {
    list.innerHTML = '<p class="empty">Nothing yet.</p>';
    return;
  }

  list.innerHTML = "";
  for (const insight of insightCards) {
    list.append(insightCard(insight));
  }
}

function insightCard(insight) {
  const el = document.createElement("div");
  el.className = `insight ${insight.kind}`;

  const kind = document.createElement("p");
  kind.className = "kind";
  kind.textContent =
    {
      contradiction: "Disagrees with your documents",
      context: "Worth knowing",
      unanswered: "Nobody answered this",
    }[insight.kind] ?? "Worth knowing";

  const text = document.createElement("p");
  text.className = "text";
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

  return el;
}

function addInsights(insights) {
  if (insights.length) {
    insightCards = [...insights, ...insightCards];
    void chrome.storage.session.set({ [INSIGHTS_KEY]: insightCards });
  }
  paintInsights();
}

function setInsightStatus(text) {
  insightStatus.hidden = !text;
  insightStatus.textContent = text ?? "";
}

function renderControls() {
  if (capturing) {
    toggle.textContent = "Stop taking notes";
    toggle.classList.add("stop");
    toggle.disabled = false;
    disclosed.disabled = true;
    discloseBlock.hidden = true;
    now.disabled = checking;
    status.innerHTML = '<span class="recording">Recording this meeting.</span>';
    return;
  }

  toggle.textContent = "Start taking notes";
  toggle.classList.remove("stop");
  toggle.disabled = !disclosed.checked;
  disclosed.disabled = false;
  discloseBlock.hidden = false;
  now.disabled = true;
  status.textContent = "Notes appear here as people speak, and in AllTheWay when the meeting ends.";
}

disclosed.addEventListener("change", () => {
  show(null);
  renderControls();
});

toggle.addEventListener("click", async () => {
  show(null);
  toggle.disabled = true;

  if (capturing) {
    await chrome.runtime.sendMessage({ type: "stop" });
    capturing = null;
    renderControls();
    return;
  }

  const { [GATEWAY_KEY]: gateway } = await chrome.storage.session.get(GATEWAY_KEY);
  if (gateway && !(await ensureGatewayAccess(gateway))) {
    show("Allow AllTheWay to reach the notes server, then try again.");
    renderControls();
    return;
  }

  const tab = await findMeetingTab();
  if (!tab?.id) {
    show("Open a Meet, Zoom, or Teams tab first.");
    renderControls();
    return;
  }

  const meetingId = `tab-${tab.id}-${Date.now()}`;
  const result = await chrome.runtime.sendMessage({
    type: "start",
    tabId: tab.id,
    meetingId,
    disclosed: disclosed.checked === true,
  });

  if (!result?.ok) {
    show(result?.reason ?? "That did not start.");
    renderControls();
    return;
  }

  capturing = { tabId: tab.id, meetingId, startedAt: Date.now() };
  lines = [];
  insightCards = [];
  persistLines();
  void chrome.storage.session.set({ [INSIGHTS_KEY]: [] });
  renderLines();
  paintInsights();
  renderControls();
});

now.addEventListener("click", () => {
  if (!capturing || checking) return;
  checking = true;
  now.disabled = true;
  setInsightStatus("Checking…");
  void chrome.runtime.sendMessage({ type: "insights-now" }).then((result) => {
    if (result?.ok) return;
    checking = false;
    now.disabled = !capturing;
    setInsightStatus(QUIET.unavailable);
    renderControls();
  });
});

function renderBot() {
  sendBot.disabled = botDisclosed.checked !== true;
}

botDisclosed.addEventListener("change", renderBot);

hideWhilePresenting.addEventListener("change", () => {
  hideInsightsPref = hideWhilePresenting.checked === true;
  void chrome.storage.sync.set({ [HIDE_INSIGHTS_KEY]: hideInsightsPref });
  paintPrivateInsights();
});

sendBot.addEventListener("click", async () => {
  botStatus.textContent = "Asking…";
  sendBot.disabled = true;

  const stored = await chrome.storage.session.get([GATEWAY_KEY, TOKEN_KEY]);
  const gateway = stored[GATEWAY_KEY];
  const token = stored[TOKEN_KEY];
  if (!gateway || !token) {
    botStatus.textContent = "Open AllTheWay in a tab and sign in first.";
    renderBot();
    return;
  }
  if (!(await ensureGatewayAccess(gateway))) {
    botStatus.textContent = "Allow AllTheWay to reach the notes server, then try again.";
    renderBot();
    return;
  }

  const tab = await findMeetingTab();
  const meetUrl = tab?.url ?? "";

  try {
    const response = await fetch(`${String(gateway).replace(/\/$/, "")}/api/meetings/bot`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        meetUrl,
        disclosed: botDisclosed.checked === true,
      }),
    });
    const body = await response.json().catch(() => ({}));
    botStatus.textContent =
      body.message ||
      (body.ok
        ? "Knocking. The host has five minutes to admit AllTheWay notes."
        : "That did not start.");
  } catch {
    botStatus.textContent = "Could not reach AllTheWay.";
  }
  renderBot();
});

chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.presenting) {
    presenting = changes.presenting.newValue === true;
    paintPrivateInsights();
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "insights" && Array.isArray(message.insights)) {
    checking = false;
    addInsights(message.insights);
    setInsightStatus(
      message.insights.length > 0 ? "" : (QUIET[message.quiet] ?? QUIET.none),
    );
    renderControls();
  }
  if (message?.type === "transcript" && typeof message.text === "string") {
    applyTranscript({
      text: message.text,
      at: message.at,
      finished: message.finished !== false,
      speaker: message.speaker,
    });
  }
  if (message?.type === "capture-error" && message.error?.message) {
    show(message.error.message);
  }
  if (message?.type === "ended") {
    capturing = null;
    checking = false;
    renderControls();
  }
  return false;
});

void chrome.runtime.sendMessage({ type: "status" }).then(async (state) => {
  capturing = state?.capturing ?? null;
  if (!state?.signedIn) {
    show("Open AllTheWay in a tab and sign in first.");
  }

  const stored = await chrome.storage.session.get([LINES_KEY, INSIGHTS_KEY, "presenting"]);
  if (Array.isArray(stored[LINES_KEY])) {
    lines = stored[LINES_KEY];
    renderLines();
  }
  if (Array.isArray(stored[INSIGHTS_KEY]) && stored[INSIGHTS_KEY].length) {
    insightCards = stored[INSIGHTS_KEY];
    paintInsights();
  }
  presenting = stored.presenting === true;

  const prefs = await chrome.storage.sync.get(HIDE_INSIGHTS_KEY);
  if (typeof prefs[HIDE_INSIGHTS_KEY] === "boolean") {
    hideInsightsPref = prefs[HIDE_INSIGHTS_KEY];
    hideWhilePresenting.checked = hideInsightsPref;
  }

  paintPrivateInsights();
  renderBot();
  renderControls();
});
