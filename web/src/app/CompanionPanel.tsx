import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  AlertTriangle,
  Loader2,
  MessageCircle,
  PanelRightClose,
  PanelRightOpen,
  Send,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { LogoMark } from "@/components/primitives/logo";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { CanvasPane } from "@/app/CanvasPane";
import { useAuth } from "@/auth/useAuth";
import { api } from "@/app/data";
import { useTurn, type ProposedAction, type TurnPhase } from "@/app/use-turn";
import { cn } from "@/lib/utils";
import { VoiceCaptions, VoiceControl } from "@/app/VoiceControl";

type Message = {
  id: number;
  role: "agent" | "user";
  text: string;
  /** Set on an agent message when the turn stopped rather than completed. */
  phase?: TurnPhase;
  options?: string[];
  actions?: ProposedAction[];
};

/**
 * Tailwind's `xl`, as a media query.
 *
 * Duplicated from the class names below because there is no way to ask the
 * stylesheet where the docked layout starts. Kept next to the `xl:` classes it
 * mirrors so the two are changed together.
 */
const DOCKED_FROM = "(min-width: 80rem)";

/**
 * The companion session.
 *
 * A fixed id rather than a new session per visit: the companion is one
 * continuing conversation, not a series of unrelated ones. It is scoped to the
 * signed-in user at the repository layer, so the constant is not a shared
 * namespace — `getSession(uid, id)` is what makes it private.
 */
const COMPANION_SESSION = "companion";

function useCompanionThread() {
  const { user } = useAuth();
  const firstName = user?.displayName?.trim().split(/\s+/)[0];

  const { turn, send: runTurn } = useTurn(COMPANION_SESSION);
  const [history, setHistory] = useState<Message[]>(() => [
    {
      id: 1,
      role: "agent",
      text: `Welcome back${firstName ? `, ${firstName}` : ""}. Ask me for something, or correct me — I learn from the corrections more than the requests.`,
    },
  ]);
  const [draft, setDraft] = useState("");

  // Dropping a document into the conversation.
  //
  // The library on the profile screen is where documents are *managed*. This is
  // where they are *used* — and the moment someone wants a contract read is the
  // moment they are talking about it, not a moment they want to navigate away
  // from to find an upload button.
  const [dropping, setDropping] = useState(false);
  const [dropNote, setDropNote] = useState<string | null>(null);

  const acceptDrop = useCallback(
    async (files: FileList) => {
      const file = Array.from(files)[0];
      if (!file) return;

      setDropNote(`Reading ${file.name}…`);
      try {
        const buffer = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let i = 0; i < buffer.length; i += 8192) {
          binary += String.fromCharCode(...buffer.subarray(i, i + 8192));
        }
        await api.uploadDocument(file.name, btoa(binary), file.type || "text/plain");
        // Said in the conversation rather than as a toast: the document is now
        // part of what it can cite, and that belongs in the thread that will
        // cite it.
        setDropNote(`${file.name} is ready — ask me about it.`);
      } catch (err) {
        // Screening refusals and unreadable photos both arrive here with a real
        // message. Showing it verbatim is the point.
        setDropNote((err as { message?: string }).message || `${file.name} could not be added.`);
      }
    },
    [],
  );
  const settled = useRef<string>("");

  /**
   * The reply, derived from which terminal state the turn reached.
   *
   * Deliberately not announced up front. A plan that turns out to be empty
   * ends as a question, so claiming "here is your plan" while it streams would
   * mean taking it back — which is the same invariant the Plan Panel keeps.
   */
  useEffect(() => {
    if (turn.phase === "working" || turn.phase === "idle") return;

    // Each turn settles once. Without this the effect re-appends on every
    // unrelated re-render.
    const key = `${turn.request}:${turn.phase}`;
    if (settled.current === key) return;
    settled.current = key;

    const text =
      turn.phase === "clarify"
        ? turn.question
        : turn.phase === "confirm"
          ? turn.summary
          : turn.phase === "error"
            ? turn.error ||
              "Something went wrong and nothing was done. Try again in a moment."
            : turn.note || "Done.";

    setHistory((prev) => [
      ...prev,
      {
        id: prev.length + 1,
        role: "agent",
        text,
        // Carried so the panel can show that a turn stopped rather than
        // finished. A confirmation that reads like a completion is the exact
        // lie FR-V2 exists to prevent.
        phase: turn.phase,
        options: turn.options,
        actions: turn.actions,
      },
    ]);
  }, [turn]);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || turn.phase === "working") return;

    setHistory((prev) => [
      ...prev,
      { id: prev.length + 1, role: "user", text: trimmed },
    ]);
    setDraft("");
    void runTurn(trimmed);
  }

  return {
    messages: history,
    draft,
    setDraft,
    send,
    working: turn.phase === "working",
    trace: turn.trace,
  };
}

type Thread = ReturnType<typeof useCompanionThread>;

/**
 * The conversation itself, with no opinion about what contains it.
 *
 * Extracted so the docked column and the sheet render the same thing rather
 * than two implementations that drift — and the thread state lives above both,
 * which is what lets a half-typed message survive a resize across the
 * breakpoint.
 */
function CompanionConversation({
  messages,
  draft,
  setDraft,
  send,
  working,
}: Thread) {
  const last = messages[messages.length - 1];
  const reduced = useReducedMotion();
  const endRef = useRef<HTMLDivElement>(null);

  // Both the docked column and the sheet render this, and the hidden one is
  // still in the DOM — so a fixed id would appear twice and `htmlFor` would
  // bind the visible label to the invisible input.
  const inputId = useId();

  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, reduced]);

  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.map((m) => (
          <motion.div
            key={m.id}
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className={cn("flex gap-2.5", m.role === "user" && "justify-end")}
          >
            {m.role === "agent" ? (
              <LogoMark className="mt-0.5 size-6 shrink-0" />
            ) : null}
            <div className="max-w-[15rem]">
              <p
                className={cn(
                  "rounded-brand px-3 py-2 text-[13.5px] leading-relaxed",
                  m.role === "agent"
                    ? "rounded-tl-sm border bg-background"
                    : "rounded-tr-sm bg-accent text-accent-foreground",
                  // A stopped turn must not look like a finished one. FR-V2 is
                  // about the user being asked, and a confirmation styled like
                  // a completion is the lie it exists to prevent.
                  m.phase === "confirm" && "border-primary/40 bg-primary/5",
                  m.phase === "error" && "border-destructive/40 bg-destructive/5",
                )}
              >
                {m.text}
              </p>

              {m.actions?.length ? (
                <ul className="mt-1.5 flex flex-col gap-1">
                  {m.actions.map((a) => (
                    <li
                      key={a.label}
                      className="flex items-start gap-1.5 text-[12px] text-muted-foreground"
                    >
                      <AlertTriangle
                        className="mt-0.5 size-3 shrink-0 text-primary"
                        aria-hidden="true"
                      />
                      <span>
                        <span className="font-medium text-foreground">{a.label}</span>
                        {a.reason ? ` — ${a.reason}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </motion.div>
        ))}

        {/* The options belong to the message that offered them, not to the
            panel. A clarify question and a confirmation both arrive with the
            answers that resolve them, and showing stale chips from an earlier
            turn would invite answering a question nobody asked. */}
        {last?.role === "agent" && last.options?.length ? (
          <div className="flex flex-wrap gap-2 pl-[34px]">
            {last.options.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => send(option)}
                disabled={working}
                className="rounded-full border bg-background px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
              >
                {option}
              </button>
            ))}
          </div>
        ) : null}

        {working ? (
          <p
            role="status"
            className="flex items-center gap-2 pl-[34px] text-[12.5px] text-muted-foreground"
          >
            <Loader2
              className="size-3.5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            Thinking…
          </p>
        ) : null}

        <div ref={endRef} />
      </div>

      <VoiceCaptions />

      {dropNote ? (
        <p role="status" className="border-t px-3 py-2 text-[12.5px] text-muted-foreground">
          {dropNote}
        </p>
      ) : null}

      <form
        className={cn(
          "flex items-center gap-2 border-t p-3 transition-colors",
          dropping && "bg-primary/5 ring-1 ring-primary/40 ring-inset",
        )}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
        onDragOver={(e) => {
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDropping(false);
          if (e.dataTransfer.files.length) void acceptDrop(e.dataTransfer.files);
        }}
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Message the companion
        </label>
        <VoiceControl size="sm" />
        <input
          id={inputId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={working}
          placeholder={
            dropping ? "Drop it here" : working ? "Working…" : "Ask, or correct it…"
          }
          className="min-w-0 flex-1 rounded-full border bg-background px-3.5 py-2 text-[13.5px] outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={!draft.trim() || working}
          className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
        >
          <Send className="size-4" aria-hidden="true" />
        </button>
      </form>
    </>
  );
}

/**
 * The third column of the concept shell: the live conversation, kept beside the
 * work rather than competing with it in a single chat column.
 *
 * Two presentations of one thread:
 *
 *  - **>= xl** — a docked column, collapsible to a rail.
 *  - **< xl** — a floating button that opens the same conversation over the
 *    work, with the page behind it blurred. Full-bleed on a phone, a
 *    right-anchored sheet on a tablet.
 *
 * The second exists because the column was `hidden` below `xl` and nothing
 * replaced it, so the companion was unreachable on every phone and tablet — and
 * on a laptop the moment devtools took the viewport under 1280px.
 *
 * Replies are local-only — this panel does not call the gateway yet. The shape
 * is real so that wiring it up later is a swap, not a rewrite.
 */
export function CompanionPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const thread = useCompanionThread();
  const [sheetOpen, setSheetOpen] = useState(false);
  // Which noun the panel is currently showing. One piece of state for
  // both presentations, so switching on desktop and reopening the sheet
  // on mobile do not disagree.
  const [mode, setMode] = useState<"chat" | "work">("chat");

  // Growing past the breakpoint hands the conversation back to the docked
  // column. Without this the sheet stays mounted and invisible, holding its
  // focus trap and scroll lock over a layout that has moved on.
  useEffect(() => {
    const mq = window.matchMedia(DOCKED_FROM);
    const sync = () => {
      if (mq.matches) setSheetOpen(false);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return (
    <>
      {open ? (
        <aside
          aria-label="Companion"
          className="hidden w-[340px] shrink-0 flex-col border-l bg-card/60 xl:sticky xl:top-0 xl:flex xl:h-dvh"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <PanelSwitch mode={mode} onMode={setMode} />
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Collapse companion panel"
              aria-expanded={true}
              className="grid size-8 place-items-center rounded-brand text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <PanelRightClose className="size-[18px]" aria-hidden="true" />
            </button>
          </div>

          {mode === "chat" ? (
            <CompanionConversation {...thread} />
          ) : (
            <CanvasPane />
          )}
        </aside>
      ) : (
        <div className="hidden shrink-0 border-l bg-card/60 p-2 xl:sticky xl:top-0 xl:block xl:h-dvh">
          <button
            type="button"
            onClick={() => onOpenChange(true)}
            aria-label="Open companion panel"
            aria-expanded={false}
            className="grid size-9 place-items-center rounded-brand text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <PanelRightOpen className="size-[18px]" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Sits above the floating tab bar below `lg`, where that bar exists; from
          `lg` up it is gone and this can drop into the corner. The safe-area
          inset is a margin rather than part of `bottom`, so neither breakpoint
          has to restate it. */}
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        aria-label="Open companion"
        aria-expanded={sheetOpen}
        className="fixed right-4 bottom-[5.75rem] z-40 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-e2 transition-transform hover:scale-105 active:scale-95 motion-reduce:transition-none motion-reduce:hover:scale-100 lg:right-6 lg:bottom-6 xl:hidden"
        style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <MessageCircle className="size-6" aria-hidden="true" />
      </button>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="right"
          aria-label="Companion"
          showCloseButton={false}
          // Full-bleed on a phone: a 3/4-width sheet on a 390px screen leaves a
          // strip of unusable page beside a cramped conversation.
          className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:w-[26rem] data-[side=right]:sm:max-w-none"
          overlayClassName="bg-black/40 supports-backdrop-filter:backdrop-blur-sm"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <PanelSwitch mode={mode} onMode={setMode} />
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              aria-label="Close companion"
              className="grid size-8 place-items-center rounded-brand text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <PanelRightClose className="size-[18px]" aria-hidden="true" />
            </button>
          </div>

          {mode === "chat" ? (
            <CompanionConversation {...thread} />
          ) : (
            <CanvasPane />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}


/**
 * The panel's two nouns.
 *
 * Deliberately not navigation. The third column has always been here; what
 * changes is whether it is showing the conversation or the thing the
 * conversation is about. A tab bar would imply two places; this implies one
 * place with two views, which is what it is.
 */
function PanelSwitch({
  mode,
  onMode,
}: {
  mode: "chat" | "work";
  onMode: (mode: "chat" | "work") => void;
}) {
  return (
    <div role="tablist" aria-label="Panel view" className="flex items-center gap-0.5 rounded-full border p-0.5">
      {(["chat", "work"] as const).map((value) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={mode === value}
          onClick={() => onMode(value)}
          className={cn(
            "rounded-full px-2.5 py-1 text-[12px] transition-colors",
            mode === value
              ? "bg-muted font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {value === "chat" ? "Chat" : "Work"}
        </button>
      ))}
    </div>
  );
}
