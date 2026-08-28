import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router";

import { Ambient } from "@/components/blocks/ambient";
import { Logo } from "@/components/primitives/logo";
import { AccountMenu } from "@/app/AccountMenu";
import { AppTopBar } from "@/app/AppTopBar";
import { Sidebar } from "@/app/Sidebar";
import { SidebarProvider } from "@/app/sidebar-state";
import { TabBar } from "@/app/TabBar";
import { CompanionPanel } from "@/app/CompanionPanel";
import { CompanionThreadProvider } from "@/app/companion-thread";
import { VoiceProvider } from "@/app/use-voice";
import { LifeAlertsProvider } from "@/app/life/alerts";
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
  const { pathname } = useLocation();
  const studio = pathname.startsWith("/app/studio");
  // Studio is a maker: the stage needs the width. Companion stays a quiet
  // reopen, not a third column that interviews them.
  const [companionOpen, setCompanionOpen] = useState(() => !studio);

  useEffect(() => {
    if (studio) setCompanionOpen(false);
  }, [studio]);

  useEffect(() => {
    registerAppServiceWorker();
  }, []);

  return (
    <CompanionThreadProvider>
    <VoiceProvider>
    <LifeAlertsProvider>
    <SidebarProvider>
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
          <AccountMenu />
        </header>

        {/* pb-28 clears the floating tab bar; dropped once the sidebar takes over. */}
        <main
          id="app-main"
          className={cn(
            "flex-1 px-4 pt-5 pb-28 sm:px-6 lg:px-8 lg:pt-6 lg:pb-10",
            studio && "lg:px-5 lg:pt-4 lg:pb-6",
          )}
        >
          {studio ? null : <AppTopBar />}
          <div
            className={cn(
              "mx-auto w-full transition-[max-width] duration-200",
              studio
                ? "max-w-none"
                : companionOpen
                  ? "max-w-5xl xl:max-w-3xl"
                  : "max-w-5xl",
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
    </SidebarProvider>
    </LifeAlertsProvider>
    </VoiceProvider>
    </CompanionThreadProvider>
  );
}
