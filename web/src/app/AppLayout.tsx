import { useEffect, useState } from "react";
import { Outlet } from "react-router";
import { Bell } from "lucide-react";

import { Ambient } from "@/components/blocks/ambient";
import { Logo } from "@/components/primitives/logo";
import { Avatar } from "@/app/Avatar";
import { AppTopBar } from "@/app/AppTopBar";
import { Sidebar } from "@/app/Sidebar";
import { TabBar } from "@/app/TabBar";
import { CompanionPanel } from "@/app/CompanionPanel";
import { registerAppServiceWorker } from "@/app/pwa";
import { cn } from "@/lib/utils";

/**
 * The product shell.
 *
 * Desktop: sidebar, work, companion.
 * Mobile: a compact top bar and a floating tab bar, so it reads as an app
 * rather than a website squeezed onto a phone.
 *
 * Ambient orbs sit behind everything because the tab bar is glass, and glass
 * over a flat fill has nothing to refract — it just looks muddy.
 */
export function AppLayout() {
  // Lifted so the work column can reclaim the width when the panel is closed.
  const [companionOpen, setCompanionOpen] = useState(true);

  useEffect(() => {
    registerAppServiceWorker();
  }, []);

  return (
    <div className="relative isolate flex min-h-dvh flex-col bg-background lg:flex-row">
      <Ambient />

      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile chrome. The desktop sidebar already carries the brand. */}
        <header
          className="glass sticky top-0 z-40 flex items-center justify-between gap-3 border-b px-4 py-3 lg:hidden"
          style={{ paddingTop: "max(env(safe-area-inset-top), 0.75rem)" }}
        >
          <Logo />
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Notifications"
              className="grid size-10 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
            >
              <Bell className="size-5" aria-hidden="true" />
            </button>
            <Avatar />
          </div>
        </header>

        {/* pb-28 clears the floating tab bar; dropped once the sidebar takes over. */}
        <main
          id="app-main"
          className="flex-1 px-4 pt-5 pb-28 sm:px-6 lg:px-8 lg:pt-6 lg:pb-10"
        >
          <AppTopBar />
          <div
            className={cn(
              "mx-auto w-full transition-[max-width] duration-200",
              companionOpen ? "max-w-3xl" : "max-w-5xl",
            )}
          >
            <Outlet />
          </div>
        </main>
      </div>

      {/* The concept's third column: the conversation, beside the work rather
          than competing with it. Appears once there is room for it. */}
      <CompanionPanel open={companionOpen} onOpenChange={setCompanionOpen} />

      <TabBar />
    </div>
  );
}
