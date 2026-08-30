import { useCallback, useState } from "react";
import type { ActOutcome } from "@alltheway/contracts";

import { api } from "@/app/data";
import { flushCompose } from "@/app/compose-flush";
import { decisionCopy } from "@/app/plan-copy";
import type { ProposedAction } from "@/app/use-turn";

/**
 * Recording a yes or a no, then showing what actually ran.
 *
 * Shared by session detail, the companion thread, and voice captions: three
 * surfaces, one meaning of Yes. Sending "Yes, go ahead" as a new turn used
 * to look like confirmation and run nothing.
 */
export function useDecision(sessionId: string) {
  const [decision, setDecision] = useState<"confirmed" | "declined" | "corrected" | null>(null);
  const [recorded, setRecorded] = useState<"pending" | "ok" | "failed">("pending");
  const [did, setDid] = useState<ActOutcome[]>([]);

  const reset = useCallback(() => {
    setDecision(null);
    setRecorded("pending");
    setDid([]);
  }, []);

  const decide = useCallback(
    async (
      kind: "confirmed" | "declined" | "corrected",
      body: {
        summary: string;
        actions: ProposedAction[];
        modality?: "voice" | "text";
        now?: string;
      },
    ) => {
      setDecision(kind);
      setRecorded("pending");
      setDid([]);
      try {
        if (kind === "confirmed") await flushCompose(sessionId);
        const result = await api.recordDecision(sessionId, {
          kind,
          summary: body.summary,
          actions: body.actions,
          modality: body.modality ?? "text",
          now: body.now,
        });
        setDid(result.did);
        setRecorded("ok");
      } catch {
        setRecorded("failed");
      }
    },
    [sessionId],
  );

  const status = decision ? decisionCopy(decision, recorded, did) : null;

  return { decision, recorded, did, decide, reset, status };
}
