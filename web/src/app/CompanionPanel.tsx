import { useEffect, useId, useRef, useState } from "react";
import {
  MessageCircle,
  PanelRightClose,
  PanelRightOpen,
  Send,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { LogoMark } from "@/components/primitives/logo";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAuth } from "@/auth/useAuth";
import { cn } from "@/lib/utils";
import { VoiceCaptions, VoiceControl } from "@/app/VoiceControl";

type Message = { id: number; role: "agent" | "user"; text: string };

const CHIPS = [
  "Yes, default to minimal",
  "Ask me each time",
  "Show me the trace",
];

/**
 * Tailwind's `xl`, as a media query.
 *
 * Duplicated from the class names below because there is no way to ask the
 * stylesheet where the docked layout starts. Kept next to the `xl:` classes it
 * mirrors so the two are changed together.
 */
const DOCKED_FROM = "(min-width: 80rem)";

function useCompanionThread() {
  const { user } = useAuth();
  const firstName = user?.displayName?.trim().split(/\s+/)[0];

  const [messages, setMessages] = useState<Message[]>(() => [
    {
      id: 1,
      role: "agent",
      text: `Welcome back${firstName ? `, ${firstName}` : ""}. I noticed you tend to trim navigation rather than add to it — want me to default to that this time?`,
    },
  ]);
  const [draft, setDraft] = useState("");

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    setMessages((prev) => [
      ...prev,
      { id: prev.length + 1, role: "user", text: trimmed },
      {
        id: prev.length + 2,
        role: "agent",
        text: "Noted — I have written that to your profile, and you can revert it from the Profile tab whenever you like.",
      },
    ]);
    setDraft("");
  }

  return { messages, draft, setDraft, send };
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
function CompanionConversation({ messages, draft, setDraft, send }: Thread) {
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
            <p
              className={cn(
                "max-w-[15rem] rounded-brand px-3 py-2 text-[13.5px] leading-relaxed",
                m.role === "agent"
                  ? "rounded-tl-sm border bg-background"
                  : "rounded-tr-sm bg-accent text-accent-foreground",
              )}
            >
              {m.text}
            </p>
          </motion.div>
        ))}

        {messages.length === 1 ? (
          <div className="flex flex-wrap gap-2 pl-[34px]">
            {CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => send(chip)}
                className="rounded-full border bg-background px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                {chip}
              </button>
            ))}
          </div>
        ) : null}

        <div ref={endRef} />
      </div>

      <VoiceCaptions />

      <form
        className="flex items-center gap-2 border-t p-3"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
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
          placeholder="Ask, or correct it…"
          className="min-w-0 flex-1 rounded-full border bg-background px-3.5 py-2 text-[13.5px] outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={!draft.trim()}
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
            <h2 className="text-[14px] font-semibold">Companion</h2>
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

          <CompanionConversation {...thread} />
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
            <h2 className="text-[14px] font-semibold">Companion</h2>
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              aria-label="Close companion"
              className="grid size-8 place-items-center rounded-brand text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <PanelRightClose className="size-[18px]" aria-hidden="true" />
            </button>
          </div>

          <CompanionConversation {...thread} />
        </SheetContent>
      </Sheet>
    </>
  );
}
