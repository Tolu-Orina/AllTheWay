import { Clapperboard, House, LayoutGrid, Radar, User } from "lucide-react";

/**
 * One nav definition, consumed by both the desktop sidebar and the mobile tab
 * bar. Two lists would drift the moment a route is added.
 *
 * Five destinations. Studio is a maker, not a Home-card secret. Agents and
 * Profile are not the product — they live under Your Profile. TabBar treats
 * `/app` as exact so Work and Studio do not light Today.
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
  { to: "/app", labelKey: "nav.today", icon: House },
  { to: "/app/work", labelKey: "nav.work", icon: LayoutGrid },
  { to: "/app/studio", labelKey: "nav.studio", icon: Clapperboard },
  { to: "/app/watchers", labelKey: "nav.watchers", icon: Radar },
  { to: "/app/you", labelKey: "nav.you", icon: User },
];
