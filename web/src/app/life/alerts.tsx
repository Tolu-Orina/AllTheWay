import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import type { Reminder } from "@alltheway/contracts";

import { api } from "@/app/data";
import { useAuth } from "@/auth/useAuth";

/**
 * In-app alerts for leave-now. Push is the lock-screen copy of the same
 * objects; this is what shows when the tab is open.
 */

const POLL_MS = 45_000;

export function dueReminders(rows: Reminder[], now = Date.now()): Reminder[] {
  return rows.filter((row) => {
    if (row.state === "dismissed") return false;
    const at = Date.parse(row.fireAt);
    if (!Number.isFinite(at)) return false;
    if (row.state === "fired") return now - at < 4 * 60 * 60 * 1000;
    return at <= now + 2 * 60 * 1000;
  });
}

type LifeAlerts = {
  reminders: Reminder[];
  due: Reminder[];
  count: number;
  refresh: () => void;
};

const Context = createContext<LifeAlerts | null>(null);

export function LifeAlertsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [reminders, setReminders] = useState<Reminder[]>([]);

  const refresh = useCallback(() => {
    if (!user) {
      setReminders([]);
      return;
    }
    void api.reminders().then(setReminders).catch(() => undefined);
  }, [user]);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const value = useMemo<LifeAlerts>(() => {
    const due = dueReminders(reminders);
    return { reminders, due, count: due.length, refresh };
  }, [reminders]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useLifeAlerts(): LifeAlerts {
  const value = useContext(Context);
  if (!value) {
    return { reminders: [], due: [], count: 0, refresh: () => undefined };
  }
  return value;
}
