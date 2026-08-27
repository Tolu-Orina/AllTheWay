/**
 * The popup: one decision, made explicitly.
 *
 * ## Why the disclosure checkbox is not a formality
 *
 * A bot appears in the participant list, so a meeting platform announces it for
 * you. Capturing a tab announces nothing — the obligation moves entirely onto
 * the person clicking this button, and in all-party-consent jurisdictions
 * (California and Illinois among them) recording without telling everyone is
 * unlawful regardless of how it is done.
 *
 * So the checkbox is unticked every time the popup opens. It is deliberately
 * not remembered: "I told them" is true of one meeting, and a remembered tick
 * would silently assert it about the next.
 */

const disclosed = document.getElementById("disclosed");
const toggle = document.getElementById("toggle");
const status = document.getElementById("status");
const error = document.getElementById("error");

let capturing = null;

function show(message) {
  error.hidden = !message;
  error.textContent = message ?? "";
}

function render() {
  if (capturing) {
    toggle.textContent = "Stop taking notes";
    toggle.classList.add("stop");
    toggle.disabled = false;
    disclosed.disabled = true;
    status.innerHTML = '<span class="recording">Recording this tab.</span>';
    return;
  }

  toggle.textContent = "Start taking notes";
  toggle.classList.remove("stop");
  // Stopping never needs permission; starting always does.
  toggle.disabled = !disclosed.checked;
  disclosed.disabled = false;
  status.textContent = "Notes appear in AllTheWay when the meeting ends.";
}

disclosed.addEventListener("change", () => {
  show(null);
  render();
});

toggle.addEventListener("click", async () => {
  show(null);
  toggle.disabled = true;

  if (capturing) {
    await chrome.runtime.sendMessage({ type: "stop" });
    capturing = null;
    render();
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    show("No tab to record.");
    render();
    return;
  }

  const result = await chrome.runtime.sendMessage({
    type: "start",
    tabId: tab.id,
    // Derived from the tab so a meeting is identifiable without asking the user
    // to name it. Stable for the life of the call, which is all it needs to be.
    meetingId: `tab-${tab.id}-${Date.now()}`,
    disclosed: disclosed.checked,
  });

  if (!result?.ok) {
    show(result?.reason ?? "That did not start.");
    render();
    return;
  }

  capturing = true;
  render();
});

void chrome.runtime.sendMessage({ type: "status" }).then((state) => {
  capturing = state?.capturing ?? null;
  if (!state?.signedIn) {
    show("Open AllTheWay in a tab and sign in first.");
  }
  render();
});
