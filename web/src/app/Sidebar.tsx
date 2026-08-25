import { NavLink, useNavigate } from "react-router";
import { DoorOpen } from "lucide-react";

import { Logo } from "@/components/primitives/logo";
import { Avatar } from "@/app/Avatar";
import { NAV } from "@/app/nav";
import { nameFor, useAppUser } from "@/app/user";
import { useAuth } from "@/auth/useAuth";
import { cn } from "@/lib/utils";

const RECENTS = [
  { id: "grant", label: "Grant application draft" },
  { id: "contract", label: "Contract law, chapter 4" },
  { id: "nav", label: "Nav wireframe" },
];

/**
 * Desktop navigation. Hidden below lg, where the tab bar takes over.
 *
 * Search and New live in the main column, not here — this is only about where
 * you are, never about what you are doing.
 */
export function Sidebar() {
  const user = useAppUser();
  const name = nameFor(user);
  const { adapter } = useAuth();
  const navigate = useNavigate();

  async function signOut() {
    await adapter.signOut();
    navigate("/login", { replace: true });
  }

  return (
    <aside className="hidden w-[264px] shrink-0 flex-col border-r bg-card/60 lg:sticky lg:top-0 lg:flex lg:h-dvh">
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
        <div className="px-2 pt-2">
          <Logo />
        </div>

        <nav aria-label="Primary" className="flex flex-col gap-0.5">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/app"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-brand px-3 py-2.5 text-[14px] font-medium transition-colors",
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
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div>
          <h2 className="px-3 pb-2 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
            Recents
          </h2>
          <ul className="flex flex-col gap-0.5">
            {RECENTS.map((r) => (
              <li key={r.id}>
                <NavLink
                  to={`/app/sessions/${r.id}`}
                  className="block truncate rounded-brand px-3 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {r.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Account. Pinned to the bottom so it never competes with navigation. */}
      <div className="mt-auto flex items-center gap-2 border-t p-3">
        <Avatar size={32} />
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
      </div>
    </aside>
  );
}
