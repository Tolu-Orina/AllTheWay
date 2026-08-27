import { useNavigate } from "react-router";
import { useCallback, useRef, useState } from "react";

import { api } from "@/app/data";

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

  const startWork = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    setStarting(true);
    try {
      const { id } = await api.createSession();
      navigate(`/app/sessions/${id}`);
    } finally {
      inflight.current = false;
      setStarting(false);
    }
  }, [navigate]);

  return { startWork, starting };
}
