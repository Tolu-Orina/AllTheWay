import { useEffect, useRef, useState } from "react";
import { PanelRightClose, PanelRightOpen, Send } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { LogoMark } from "@/components/primitives/logo";
import { cn } from "@/lib/utils";

type Message = { id: number; role: "agent" | "user"; text: string };

const OPENING: Message[] = [
  {
    id: 1,
    role: "agent",
    text: "Welcome back, Jordan. I noticed you tend to trim navigation rather than add to it — want me to default to that this time?",
  },
];

const CHIPS = [
  "Yes, default to minimal",
  "Ask me each time",
  "Show me the trace",
];

/**
 * The third column of the concept shell: the live conversation, kept beside the
 * work rather than competing with it in a single chat column.
 *
 * Replies are local-only — there is no gateway yet. The shape is real so that
 * wiring it up later is a swap, not a rewrite.
 */
export function CompanionPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const reduced = useReducedMotion();
  const [messages, setMessages] = useState<Message[]>(OPENING);
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, reduced]);

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

  if (!open) {
    return (
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
    );
  }

  return (
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

      <form
        className="flex items-center gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <label htmlFor="companion-input" className="sr-only">
          Message the companion
        </label>
        <input
          id="companion-input"
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
    </aside>
  );
}
