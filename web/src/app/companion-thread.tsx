import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { firstNameFor, useAppUser } from "@/app/user";
import { api } from "@/app/data";
import { useT } from "@/app/i18n";
import { useAsync } from "@/app/use-async";
import { useDecision } from "@/app/use-decision";
import { useTurn, type ProposedAction, type TurnPhase } from "@/app/use-turn";
import { persistCompanionSessionId, readCompanionSessionId } from "@/app/work-id";
import { ApiError } from "@/lib/api";
import { pendingConfirmId } from "@/app/ConfirmGate";
import { isSpokenYes } from "@/lib/spoken-confirm";
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
  sessionId: string;
  messages: CompanionMessage[];
  draft: string;
  setDraft: (text: string) => void;
  send: (text: string) => void;
  startNewChat: () => Promise<void>;
  openChat: (id: string) => void;
  chatsVersion: number;
  startingNew: boolean;
  /**
   * Spoken line that already ran through Live — do not `send()` it or it
   * would fire a second, typed turn.
   */
  recordSpoken: (role: "user" | "agent", text: string) => void;
  /** Opens the companion sheet. Same path on every screen size. */
  openCompanion: () => void;
  companionOpenNonce: number;
  working: boolean;
  trace: string[];
  steps: PlanStep[];
  job: OnboardingJob | null;
  refreshOnboarding: () => void;
  decide: (
    kind: "confirmed" | "declined" | "corrected",
    body: { summary: string; actions: ProposedAction[]; now?: string; modality?: "voice" | "text" },
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
  const mapped: CompanionMessage[] = thread.map((m, i) => ({
    id: i + 1,
    role: m.role,
    text: m.text,
    phase: m.phase,
    options: m.options,
    actions: m.actions,
    citations: m.citations,
    steps: m.steps,
  }));
  const last = mapped[mapped.length - 1];
  if (
    last?.role === "agent" &&
    last.actions?.length &&
    last.phase !== "clarify" &&
    last.phase !== "error"
  ) {
    last.phase = "confirm";
  }
  return mapped;
}

/**
 * One companion thread for the shell.
 *
 * Home used to host its own composer. That forked the thread. Send, draft
 * and history live here so the sheet is one conversation, not a fork per size.
 */
export function CompanionThreadProvider({ children }: { children: React.ReactNode }) {
  const t = useT();
  const firstName = firstNameFor(useAppUser());
  const who = firstName ? `, ${firstName}` : "";

  const { state: onboarding, reload: refreshOnboarding } = useAsync(() => api.onboarding());
  const job =
    onboarding.status === "ready" ? onboarding.data.job : null;

  const welcome = t(welcomeKey(job), { who });

  const [sessionId, setSessionId] = useState(readCompanionSessionId);
  const [chatsVersion, setChatsVersion] = useState(0);
  const [startingNew, setStartingNew] = useState(false);

  const { turn, send: runTurn, reset: resetTurn } = useTurn(sessionId);
  const { decide, reset: resetDecision, status: decisionStatus } = useDecision(sessionId);
  const [history, setHistory] = useState<CompanionMessage[]>(() => [
    { id: 1, role: "agent", text: welcome },
  ]);
  const [draft, setDraft] = useState("");
  const [companionOpenNonce, setCompanionOpenNonce] = useState(0);
  const settled = useRef<string>("");
  const hydrated = useRef(false);
  /** Uploads that landed while a turn was already running. Dropping them is how
   *  four PDFs became one summary. */
  const pending = useRef<string[]>([]);
  const draining = useRef(false);

  // The thread is stored on this companion session. Reload used to start from
  // the welcome bubble every time, which is how a conversation the person
  // had just had vanished. Switching chats must load that session, not the last.
  useEffect(() => {
    let live = true;
    settled.current = "";
    pending.current = [];
    draining.current = false;
    hydrated.current = false;
    setHistory([{ id: 1, role: "agent", text: welcome }]);
    resetTurn();
    resetDecision();
    void api
      .session(sessionId)
      .then((detail) => {
        if (!live || !detail?.thread?.length) return;
        setHistory((prev) => {
          // A send that landed before this GET must not be overwritten.
          if (prev.some((m) => m.role === "user")) return prev;
          hydrated.current = true;
          return fromStored(detail.thread);
        });
      })
      .catch((err) => {
        // Offline or a missing row. A stored uuid that 404s must not be
        // recreated as Work by the next turn — allocate a companion row instead.
        if (!(err instanceof ApiError) || err.status !== 404) return;
        if (sessionId === "companion") return;
        void api.createSession("companion").then((created) => {
          if (!live) return;
          persistCompanionSessionId(created.id);
          setSessionId(created.id);
        });
      });
    return () => {
      live = false;
    };
  }, [sessionId, resetTurn, resetDecision]);

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

    setHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "agent" && last.phase === turn.phase && last.text === text) {
        return prev;
      }
      // A write plan settles at confirm. A later `done` for the same request
      // used to append a second bubble with the same words.
      if (turn.phase === "done" && last?.role === "agent" && last.phase === "confirm") {
        return prev;
      }
      return [
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
      ];
    });
  }, [turn]);

  const send = useCallback(
    (text: string) => {
      let trimmed = text.trim();
      if (!trimmed) return;

      if (turn.phase === "working") {
        pending.current.push(trimmed);
        return;
      }

      const lastAgent =
        history.find((m) => m.id === pendingConfirmId(history)) ??
        [...history].reverse().find((m) => m.role === "agent");
      if (lastAgent?.phase === "clarify" && lastAgent.options?.length) {
        const numbered = /^(\d+)$/.exec(trimmed);
        if (numbered) {
          const picked = lastAgent.options[Number(numbered[1]) - 1];
          if (picked) trimmed = picked;
        }
      }
      if (lastAgent?.actions?.length && (trimmed === "1" || isSpokenYes(trimmed))) {
        setHistory((prev) => [
          ...prev,
          { id: prev.length + 1, role: "user", text: trimmed },
        ]);
        setDraft("");
        void decide("confirmed", {
          summary: lastAgent.text,
          actions: lastAgent.actions,
        });
        return;
      }

      setHistory((prev) => [
        ...prev,
        { id: prev.length + 1, role: "user", text: trimmed },
      ]);
      setDraft("");
      if (lastAgent?.actions?.some((a) => a.connector && a.tool)) {
        void (async () => {
          await decide("corrected", {
            summary: lastAgent.text,
            actions: lastAgent.actions ?? [],
            now: trimmed,
          });
          resetDecision();
          void runTurn(trimmed);
        })();
        return;
      }
      resetDecision();
      void runTurn(trimmed);
    },
    [runTurn, turn.phase, resetDecision, history, decide],
  );

  useEffect(() => {
    if (turn.phase === "working") {
      draining.current = false;
      return;
    }
    if (turn.phase === "confirm" || turn.phase === "clarify") return;
    if (draining.current) return;
    const next = pending.current[0];
    if (!next) return;
    draining.current = true;
    pending.current = pending.current.slice(1);
    send(next);
  }, [turn.phase, send]);

  const recordSpoken = useCallback((role: "user" | "agent", text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === role && last.text === trimmed && !last.phase) return prev;
      return [...prev, { id: prev.length + 1, role, text: trimmed }];
    });
  }, []);

  const openCompanion = useCallback(() => {
    setCompanionOpenNonce((n) => n + 1);
  }, []);

  const openChat = useCallback((id: string) => {
    const next = id.trim();
    if (!next) return;
    persistCompanionSessionId(next);
    setSessionId(next);
  }, []);

  const startNewChat = useCallback(async () => {
    if (startingNew) return;
    setStartingNew(true);
    try {
      const created = await api.createSession("companion");
      persistCompanionSessionId(created.id);
      setSessionId(created.id);
      setChatsVersion((n) => n + 1);
    } finally {
      setStartingNew(false);
    }
  }, [startingNew]);

  const value = useMemo<CompanionThread>(
    () => ({
      sessionId,
      messages: history,
      draft,
      setDraft,
      send,
      startNewChat,
      openChat,
      chatsVersion,
      startingNew,
      recordSpoken,
      openCompanion,
      companionOpenNonce,
      working: turn.phase === "working",
      trace: turn.trace,
      steps: turn.steps,
      job,
      refreshOnboarding,
      decide,
      decisionStatus,
    }),
    [sessionId, history, draft, send, startNewChat, openChat, chatsVersion, startingNew, recordSpoken, openCompanion, companionOpenNonce, turn.phase, turn.trace, turn.steps, job, refreshOnboarding, decide, decisionStatus],
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
