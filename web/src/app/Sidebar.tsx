import { NavLink, useNavigate } from "react-router";
import { DoorOpen, PanelLeft, PanelLeftClose } from "lucide-react";

import { Logo, LogoMark } from "@/components/primitives/logo";
import { Avatar } from "@/app/Avatar";
import { NAV } from "@/app/nav";
import { useT } from "@/app/i18n";
import { useAsync } from "@/app/use-async";
import { api } from "@/app/data";
import { nameFor, useAppUser } from "@/app/user";
import { useAuth } from "@/auth/useAuth";
import { useSidebar } from "@/app/sidebar-state";
import { cn } from "@/lib/utils";
import { useLifeAlerts } from "@/app/life/alerts";

/**
 * Desktop navigation. Hidden below lg, where the tab bar takes over.
 *
 * Search and New live in the main column, not here — this is only about where
 * you are, never about what you are doing.
 *
 * Recents are the last five work items from the API. Placeholders used to live
 * here and linked to sessions that did not exist; the heading is omitted until
 * there is something real to list. Recents hide when the rail is collapsed.
 */
export function Sidebar() {
  const t = useT();
  const user = useAppUser();
  const name = nameFor(user);
  const { adapter } = useAuth();
  const navigate = useNavigate();
  const { collapsed, toggle } = useSidebar();
  const { count } = useLifeAlerts();
  const { state } = useAsync(() => api.sessions());
  const recents = state.status === "ready" ? state.data.slice(0, 5) : [];

  async function signOut() {
    await adapter.signOut();
    navigate("/login", { replace: true });
  }

  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-r bg-card/60 lg:sticky lg:top-0 lg:flex lg:h-dvh",
        collapsed ? "w-16" : "w-[264px]",
      )}
    >
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-y-auto",
          collapsed ? "items-center gap-4 px-2 py-3" : "gap-6 p-4",
        )}
      >
        <div className={cn("flex items-center", collapsed ? "flex-col gap-2" : "justify-between gap-2 px-2 pt-2")}>
          {collapsed ? <LogoMark /> : <Logo />}
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
            title={collapsed ? t("nav.expand") : t("nav.collapse")}
            aria-expanded={!collapsed}
            className="grid size-9 shrink-0 place-items-center rounded-brand text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {collapsed ? (
              <PanelLeft className="size-[18px]" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="size-[18px]" aria-hidden="true" />
            )}
          </button>
        </div>

        <nav aria-label="Primary" className={cn("flex flex-col gap-0.5", collapsed && "w-full items-center")}>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/app"}
              title={collapsed ? t(item.labelKey) : undefined}
              className={({ isActive }) =>
                cn(
                  "flex items-center rounded-brand text-[14px] font-medium transition-colors",
                  collapsed ? "size-10 justify-center" : "gap-3 px-3 py-2.5",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon
                    className="size-[18px] shrink-0"
                    strokeWidth={isActive ? 2.3 : 1.9}
                    aria-hidden="true"
                  />
                  {collapsed ? <span className="sr-only">{t(item.labelKey)}</span> : t(item.labelKey)}
                  {item.to === "/app" && count > 0 ? (
                    <span className="ml-auto size-1.5 shrink-0 rounded-full bg-primary" aria-label={String(count)} />
                  ) : null}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {!collapsed && recents.length > 0 ? (
          <div>
            <h2 className="px-3 pb-2 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
              {t("nav.recents")}
            </h2>
            <ul className="flex flex-col gap-0.5">
              {recents.map((r) => (
                <li key={r.id}>
                  <NavLink
                    to={`/app/work/${r.id}`}
                    className="block truncate rounded-brand px-3 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {r.title}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {/* Account. Pinned to the bottom so it never competes with navigation. */}
      <div
        className={cn(
          "mt-auto flex items-center border-t",
          collapsed ? "flex-col gap-2 p-2" : "gap-2 p-3",
        )}
      >
        <Avatar size={32} />
        {collapsed ? (
          <button
            type="button"
            onClick={signOut}
            aria-label="Sign out"
            title="Sign out"
            className="grid size-9 shrink-0 place-items-center rounded-brand text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <DoorOpen className="size-[18px]" aria-hidden="true" />
          </button>
        ) : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{name}</span>
              <span className="block truncate text-[12px] text-muted-foreground">
                {user.email}
              </span>
            </span>
            <button
              type="button"
              onClick={signOut}
              aria-label="Sign out"
              title="Sign out"
              className="grid size-9 shrink-0 place-items-center rounded-brand text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <DoorOpen className="size-[18px]" aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
