import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useAuth } from "@/auth/useAuth";
import { api } from "@/app/data";
import { useT } from "@/app/i18n";
import { useAsync } from "@/app/use-async";
import { useDecision } from "@/app/use-decision";
import { useTurn, type ProposedAction, type TurnPhase } from "@/app/use-turn";
import { COMPANION_SESSION_ID } from "@/app/work-id";
import type { Citation, OnboardingJob, PlanStep, ThreadMessage } from "@alltheway/contracts";

export type CompanionMessage = {
  id: number;
  role: "agent" | "user";
  text: string;
  /** Set on an agent message when the turn stopped rather than completed. */
  phase?: TurnPhase;
  options?: string[];
  actions?: ProposedAction[];
  citations?: Citation[];
  steps?: PlanStep[];
};

type CompanionThread = {
  messages: CompanionMessage[];
  draft: string;
  setDraft: (text: string) => void;
  send: (text: string) => void;
  working: boolean;
  trace: string[];
  steps: PlanStep[];
  job: OnboardingJob | null;
  refreshOnboarding: () => void;
  decide: (
    kind: "confirmed" | "declined",
    body: { summary: string; actions: ProposedAction[] },
  ) => Promise<void>;
  decisionStatus: string | null;
};

const Context = createContext<CompanionThread | null>(null);

function welcomeKey(job: OnboardingJob | null): string {
  if (job === "talk") return "today.welcomeTalk";
  if (job === "document") return "today.welcomeDocument";
  if (job === "meetings") return "today.welcomeMeetings";
  if (job === "skipped") return "today.welcomeSkipped";
  return "today.welcomeGeneric";
}

function fromStored(thread: ThreadMessage[]): CompanionMessage[] {
  return thread.map((m, i) => ({
    id: i + 1,
    role: m.role,
    text: m.text,
    phase: m.phase,
    options: m.options,
    actions: m.actions,
    citations: m.citations,
    steps: m.steps,
  }));
}

/**
 * One companion thread for the shell.
 *
 * Home's on-page composer and the panel/sheet must share send, draft and
 * history. Two `useTurn("companion")` hooks would fork the conversation the
 * moment someone typed on a phone.
 */
export function CompanionThreadProvider({ children }: { children: React.ReactNode }) {
  const t = useT();
  const { user } = useAuth();
  const firstName = user?.displayName?.trim().split(/\s+/)[0];
  const who = firstName ? `, ${firstName}` : "";

  const { state: onboarding, reload: refreshOnboarding } = useAsync(() => api.onboarding());
  const job =
    onboarding.status === "ready" ? onboarding.data.job : null;

  const welcome = t(welcomeKey(job), { who });

  const { turn, send: runTurn } = useTurn(COMPANION_SESSION_ID);
  const { decide, reset: resetDecision, status: decisionStatus } = useDecision(
    COMPANION_SESSION_ID,
  );
  const [history, setHistory] = useState<CompanionMessage[]>(() => [
    { id: 1, role: "agent", text: welcome },
  ]);
  const [draft, setDraft] = useState("");
  const settled = useRef<string>("");
  const hydrated = useRef(false);

  // The thread is stored on the companion session. Reload used to start from
  // the welcome bubble every time, which is how a conversation the person
  // had just had vanished.
  useEffect(() => {
    let live = true;
    void api
      .session(COMPANION_SESSION_ID)
      .then((detail) => {
        if (!live || !detail?.thread?.length) return;
        setHistory((prev) => {
          // A send that landed before this GET must not be overwritten.
          if (prev.some((m) => m.role === "user")) return prev;
          hydrated.current = true;
          return fromStored(detail.thread);
        });
      })
      .catch(() => {
        // No session yet, or offline. The welcome bubble stays.
      });
    return () => {
      live = false;
    };
  }, []);

  // Replace the opening bubble while it is still the only message. After they
  // have spoken — or after a stored thread has been restored — a job-aware
  // rewrite would look like the companion forgot.
  useEffect(() => {
    if (hydrated.current) return;
    setHistory((prev) => {
      if (prev.length !== 1 || prev[0].role !== "agent") return prev;
      if (prev[0].text === welcome) return prev;
      return [{ ...prev[0], text: welcome }];
    });
  }, [welcome]);

  /**
   * The reply, derived from which terminal state the turn reached.
   *
   * Deliberately not announced up front. A plan that turns out to be empty
   * ends as a question, so claiming "here is your plan" while it streams would
   * mean taking it back — which is the same invariant the Plan Panel keeps.
   */
  useEffect(() => {
    if (turn.phase === "working" || turn.phase === "idle") return;

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
        phase: turn.phase,
        options: turn.options,
        actions: turn.actions,
        citations: turn.citations,
        steps: turn.steps.length ? turn.steps : undefined,
      },
    ]);
  }, [turn]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || turn.phase === "working") return;

      setHistory((prev) => [
        ...prev,
        { id: prev.length + 1, role: "user", text: trimmed },
      ]);
      setDraft("");
      resetDecision();
      void runTurn(trimmed);
    },
    [runTurn, turn.phase, resetDecision],
  );

  const value = useMemo<CompanionThread>(
    () => ({
      messages: history,
      draft,
      setDraft,
      send,
      working: turn.phase === "working",
      trace: turn.trace,
      steps: turn.steps,
      job,
      refreshOnboarding,
      decide,
      decisionStatus,
    }),
    [history, draft, send, turn.phase, turn.trace, turn.steps, job, refreshOnboarding, decide, decisionStatus],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useCompanionThread(): CompanionThread {
  const value = useContext(Context);
  if (!value) {
    throw new Error("useCompanionThread must be used inside <CompanionThreadProvider>.");
  }
  return value;
}
