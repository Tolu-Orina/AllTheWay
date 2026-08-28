import { NavLink, useLocation } from "react-router";
import { motion, useReducedMotion } from "motion/react";

import { NAV } from "@/app/nav";
import { useT } from "@/app/i18n";
import { cn } from "@/lib/utils";
import { useLifeAlerts } from "@/app/life/alerts";

/**
 * Mobile tab bar: a floating glass pill where only the active tab carries its
 * label, so five destinations fit without crowding.
 *
 * The label is always in the accessibility tree — inactive tabs hide it
 * visually with sr-only rather than dropping it, so an icon-only tab is never
 * an unlabelled control.
 */
export function TabBar() {
  const t = useT();
  const reduced = useReducedMotion();
  const { pathname } = useLocation();
  const { count } = useLifeAlerts();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 px-3 lg:hidden"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
    >
      <div className="glass mx-auto flex max-w-lg items-center gap-0.5 rounded-full p-1.5 shadow-e2">
        {NAV.map((item) => {
          // `end` on the index route only, or every child route would light it up.
          const active =
            item.to === "/app"
              ? pathname === "/app"
              : pathname.startsWith(item.to);

          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/app"}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-2.5 sm:px-3",
                "text-[12px] font-semibold transition-colors",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {active ? (
                <motion.span
                  layoutId={reduced ? undefined : "tab-pill"}
                  className="absolute inset-0 rounded-full bg-card shadow-e1"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              ) : null}

              <item.icon
                className="relative size-[18px] shrink-0"
                strokeWidth={active ? 2.4 : 1.9}
                aria-hidden="true"
              />
              {item.to === "/app" && count > 0 ? (
                <span
                  className="absolute top-1.5 right-2 size-1.5 rounded-full bg-primary"
                  aria-label={String(count)}
                />
              ) : null}
              <span className={cn("relative", active ? "inline" : "sr-only")}>
                {t(item.labelKey)}
              </span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
