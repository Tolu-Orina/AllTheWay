import { useEffect, useId, useRef, useState } from "react";
import { useT } from "@/app/i18n";
import { LogOut, User } from "lucide-react";
import { useNavigate } from "react-router";

import { Avatar } from "@/app/Avatar";
import { nameFor, useAppUser } from "@/app/user";
import { useAuth } from "@/auth/useAuth";
import { cn } from "@/lib/utils";

/**
 * The account menu behind the avatar.
 *
 * ## Why this exists
 *
 * Sign out lived only in the sidebar, and the sidebar is `hidden … lg:flex` —
 * so on a phone there was no way to sign out at all. The avatar was a `<span>`
 * with no interaction, which is exactly where someone looks first.
 *
 * ## It closes the way people expect
 *
 * Escape, a click outside, and following a link all close it. A menu that traps
 * you is worse than no menu, and on a phone an overlay you cannot dismiss reads
 * as the app having frozen.
 */
export function AccountMenu({ className }: { className?: string }) {
  const t = useT();
  const user = useAppUser();
  const name = nameFor(user);
  const { adapter } = useAuth();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function signOut() {
    setOpen(false);
    await adapter.signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div ref={container} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account: ${name}`}
        className="grid place-items-center rounded-full transition-transform active:scale-95"
      >
        <Avatar />
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-brand border bg-card shadow-e2"
        >
          <p className="truncate border-b px-3.5 py-2.5 text-[12.5px] text-muted-foreground">
            {/* Whose account this is. On a shared device the menu is the only
                place that answers it. */}
            {user?.email ?? name}
          </p>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate("/app/profile");
            }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13.5px] transition-colors hover:bg-muted"
          >
            <User className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {t("nav.profile")}
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => void signOut()}
            className="flex w-full items-center gap-2.5 border-t px-3.5 py-2.5 text-left text-[13.5px] transition-colors hover:bg-muted"
          >
            <LogOut className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {t("account.signOut")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
