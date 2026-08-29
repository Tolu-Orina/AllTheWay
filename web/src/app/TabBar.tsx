import { NavLink, useLocation } from "react-router";
import { motion, useReducedMotion } from "motion/react";

import { NAV } from "@/app/nav";
import { useT } from "@/app/i18n";
import { cn } from "@/lib/utils";
import { useLifeAlerts } from "@/app/life/alerts";

/**
 * Mobile tab bar: a floating glass pill with a label under every icon.
 *
 * iOS, WhatsApp and Google Calendar all keep the name visible on every tab —
 * hiding it until the tab is active is how a site-on-a-phone reads. QA and PM
 * asked for the labels underneath, and present by default.
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
      <div className="glass mx-auto flex max-w-lg items-end gap-0.5 rounded-[28px] px-1.5 py-1.5 shadow-e2">
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
                "relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-full px-1 pt-2 pb-1.5",
                "text-[10px] leading-tight font-semibold transition-colors",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {active ? (
                <motion.span
                  layoutId={reduced ? undefined : "tab-pill"}
                  className="absolute inset-0 rounded-[22px] bg-card shadow-e1"
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
                  className="absolute top-1.5 right-[18%] size-1.5 rounded-full bg-primary"
                  aria-label={String(count)}
                />
              ) : null}
              <span className="relative text-center">
                {t(item.tabLabelKey ?? item.labelKey)}
              </span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
