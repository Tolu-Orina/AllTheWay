import { useNavigate } from "react-router";
import { useCallback, useRef, useState } from "react";

import { api } from "@/app/data";

export type StartWorkOptions = {
  /** First message, sent once the work item exists. */
  seed?: string;
  /** Put `seed` in the composer instead of sending it. Researcher stays a prompt. */
  promptOnly?: boolean;
};

/**
 * New work: allocate a row, then go there. First message retitles it.
 *
 * `starting` is only for disabling the button while the POST is in flight.
 * It must reset even after a successful navigate — AppTopBar stays mounted.
 */
export function useStartWork() {
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const inflight = useRef(false);

  const startWork = useCallback(
    async (opts?: StartWorkOptions) => {
      if (inflight.current) return;
      inflight.current = true;
      setStarting(true);
      try {
        const { id } = await api.createSession();
        if (opts?.seed != null) {
          // Survive React Strict Mode remount: location.state is consumed on
          // the first mount, and that mount's in-flight turn is aborted.
          try {
            sessionStorage.setItem(
              `atw:work-seed:${id}`,
              JSON.stringify({ seed: opts.seed, promptOnly: opts.promptOnly === true }),
            );
          } catch {
            /* private windows */
          }
        }
        navigate(`/app/work/${id}`, {
          state:
            opts?.seed != null
              ? { seed: opts.seed, promptOnly: opts.promptOnly === true }
              : undefined,
        });
      } finally {
        inflight.current = false;
        setStarting(false);
      }
    },
    [navigate],
  );

  return { startWork, starting };
}
