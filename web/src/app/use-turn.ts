import { useCallback, useEffect, useRef, useState } from "react";
import type { Citation, PlanStep, ThreadAttachment } from "@alltheway/contracts";

import { streamTurn } from "@/lib/stream";

/**
 * A turn, as it arrives.
 *
 * State only ever grows: steps append, trace appends, and nothing already shown
 * is rewritten. That is guaranteed upstream — the orchestrator withholds any
 * value still arriving — and this hook must not undo it by, say, replacing the
 * step list on each event.
 *
 * `phase` is derived from which terminal event landed rather than announced up
 * front, because a plan that turns out to be empty ends as a question.
 */
export type TurnPhase = "idle" | "working" | "clarify" | "confirm" | "done" | "error";

export type ProposedAction = {
  label: string;
  action: string;
  reason: string;
  connector?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
};

export type TurnState = {
  phase: TurnPhase;
  /** What the user asked, echoed back immediately so the UI never feels dead. */
  request: string;
  trace: string[];
  steps: PlanStep[];
  question: string;
  options: string[];
  /** FR-V2: what the agent must be told "yes" about before anything runs. */
  summary: string;
  actions: ProposedAction[];
  note: string;
  error: string;
  citations: Citation[];
};

const EMPTY: TurnState = {
  phase: "idle",
  request: "",
  trace: [],
  steps: [],
  question: "",
  options: [],
  summary: "",
  actions: [],
  note: "",
  error: "",
  citations: [],
};

export function useTurn(sessionId: string) {
  const [state, setState] = useState<TurnState>(EMPTY);
  const abort = useRef<AbortController | null>(null);

  // A turn in flight belongs to the session that started it. Leaving the screen
  // must stop it, or events land in a component that is gone.
  useEffect(() => {
    return () => abort.current?.abort();
  }, [sessionId]);

  const send = useCallback(
    async (message: string, opts?: { attachments?: ThreadAttachment[] }) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;

      setState({ ...EMPTY, phase: "working", request: message });

      await streamTurn(sessionId, message, {
        signal: controller.signal,
        attachments: opts?.attachments,
        onEvent: (event) => {
          setState((prev) => {
            switch (event.kind) {
              case "trace":
                return { ...prev, trace: [...prev.trace, event.text] };
              case "step":
                return { ...prev, steps: [...prev.steps, event.step] };
              case "clarify":
                return {
                  ...prev,
                  phase: "clarify",
                  question: event.question,
                  options: event.options,
                };
              case "confirm":
                return {
                  ...prev,
                  phase: "confirm",
                  summary: event.summary,
                  options: event.options,
                  actions: event.actions,
                };
              case "citation":
                return {
                  ...prev,
                  citations: [
                    ...prev.citations,
                    {
                      documentId: event.documentId,
                      chunkId: event.chunkId,
                      page: event.page,
                      title: event.title,
                      text: event.text,
                      kind: event.url.startsWith("http") ? "web" : "document",
                      url: event.url,
                    },
                  ],
                };
              case "done":
                if (prev.phase === "confirm" || prev.phase === "clarify") return prev;
                return {
                  ...prev,
                  phase: "done",
                  note: event.note,
                  citations: event.citations.length ? event.citations : prev.citations,
                };
              case "error":
                return { ...prev, phase: "error", error: event.message };
              default:
                return prev;
            }
          });
        },
      });
    },
    [sessionId],
  );

  const reset = useCallback(() => {
    abort.current?.abort();
    setState(EMPTY);
  }, []);

  return { turn: state, send, reset };
}
