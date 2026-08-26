import { Brain, House, LayoutGrid, Radar, ShieldCheck } from "lucide-react";

/**
 * One nav definition, consumed by both the desktop sidebar and the mobile tab
 * bar. Two lists would drift the moment a route is added.
 */
export type NavItem = {
  to: string;
  label: string;
  icon: React.ElementType;
  /** Shown in the sidebar only — the tab bar has no room for it. */
  hint?: string;
};

export const NAV: NavItem[] = [
  { to: "/app", label: "Home", icon: House, hint: "Today at a glance" },
  {
    to: "/app/sessions",
    label: "Sessions",
    icon: LayoutGrid,
    hint: "Work in progress",
  },
  {
    to: "/app/watchers",
    label: "Watchers",
    icon: Radar,
    hint: "Running for you",
  },
  {
    to: "/app/agents",
    label: "Agents",
    icon: ShieldCheck,
    hint: "What can act, and who vouches for it",
  },
  {
    to: "/app/profile",
    label: "Profile",
    icon: Brain,
    hint: "What it has learned",
  },
];
