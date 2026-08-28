import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useLocation } from "react-router";

/**
 * Desktop sidebar width. Collapsed is an icon rail, not an overlay — nav
 * context stays on screen, the stage just gets the width.
 *
 * Preference lives in localStorage because it is about this browser's layout,
 * not about the person. Language is the opposite, and lives on the server.
 *
 * On Studio, with no stored preference, the rail starts collapsed so the maker
 * has the width. Anywhere else it starts expanded. Toggling writes the
 * preference and it then applies on every page.
 */

const STORAGE_KEY = "alltheway.sidebar";

type Stored = "expanded" | "collapsed";

function readStored(): Stored | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "expanded" || value === "collapsed") return value;
  } catch {
    /* private mode, or storage blocked */
  }
  return null;
}

function writeStored(value: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* ignore */
  }
}

type SidebarContextValue = {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (next: boolean) => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const studio = pathname.startsWith("/app/studio");
  const [stored, setStored] = useState<Stored | null>(() => readStored());

  const collapsed = stored === "collapsed" || (stored === null && studio);

  const setCollapsed = useCallback((next: boolean) => {
    const value: Stored = next ? "collapsed" : "expanded";
    setStored(value);
    writeStored(value);
  }, []);

  const toggle = useCallback(() => {
    setCollapsed(!collapsed);
  }, [collapsed, setCollapsed]);

  return (
    <SidebarContext.Provider value={{ collapsed, toggle, setCollapsed }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const value = useContext(SidebarContext);
  if (!value) {
    throw new Error("useSidebar must be used inside SidebarProvider");
  }
  return value;
}
