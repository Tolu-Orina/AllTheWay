import { Brain, House, LayoutGrid, Radar, ShieldCheck } from "lucide-react";

/**
 * One nav definition, consumed by both the desktop sidebar and the mobile tab
 * bar. Two lists would drift the moment a route is added.
 */
export type NavItem = {
  to: string;
  /**
   * A catalogue key, not a label. Both consumers translate it at render, so a
   * language change re-renders the nav rather than leaving English behind.
   */
  labelKey: string;
  icon: React.ElementType;
};

export const NAV: NavItem[] = [
  { to: "/app", labelKey: "nav.home", icon: House },
  { to: "/app/sessions", labelKey: "nav.sessions", icon: LayoutGrid },
  { to: "/app/watchers", labelKey: "nav.watchers", icon: Radar },
  { to: "/app/agents", labelKey: "nav.agents", icon: ShieldCheck },
  { to: "/app/profile", labelKey: "nav.profile", icon: Brain },
];
