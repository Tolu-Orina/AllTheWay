import { NavLink, useLocation } from "react-router";
import { motion, useReducedMotion } from "motion/react";

import { NAV } from "@/app/nav";
import { cn } from "@/lib/utils";

/**
 * Mobile tab bar: a floating glass pill where only the active tab carries its
 * label, so four destinations fit without crowding.
 *
 * The label is always in the accessibility tree — inactive tabs hide it
 * visually with sr-only rather than dropping it, so an icon-only tab is never
 * an unlabelled control.
 */
export function TabBar() {
  const reduced = useReducedMotion();
  const { pathname } = useLocation();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 px-3 lg:hidden"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
    >
      <div className="glass mx-auto flex max-w-md items-center gap-1 rounded-full p-1.5 shadow-e2">
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
                "relative flex flex-1 items-center justify-center gap-2 rounded-full px-3 py-2.5",
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
              <span className={cn("relative", active ? "inline" : "sr-only")}>
                {item.label}
              </span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
