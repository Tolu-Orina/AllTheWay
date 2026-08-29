import { useEffect } from "react";
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
import { VoiceSessionOverlay } from "@/app/VoiceSessionOverlay";
import { LifeAlertsProvider } from "@/app/life/alerts";
import { registerAppServiceWorker } from "@/app/pwa";
import { cn } from "@/lib/utils";

/**
 * The product shell.
 *
 * Desktop: sidebar and work; the companion is a FAB that opens a sheet.
 * Mobile: a compact top bar and a floating tab bar, so it reads as an app
 * rather than a website squeezed onto a phone.
 *
 * Ambient orbs sit behind everything because the tab bar is glass, and glass
 * over a flat fill has nothing to refract — it just looks muddy.
 */
export function AppLayout() {
  const { pathname } = useLocation();
  const studio = pathname.startsWith("/app/studio");
  const today = pathname === "/app";

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
          {today ? null : <AccountMenu />}
        </header>

        {/* pb-28 clears the floating tab bar; dropped once the sidebar takes over. */}
        <main
          id="app-main"
          className={cn(
            "flex-1 px-4 pt-5 pb-28 sm:px-6 lg:px-8 lg:pt-6 lg:pb-10",
            studio && "lg:px-5 lg:pt-4 lg:pb-6",
          )}
        >
          {studio || today ? null : <AppTopBar />}
          <div
            className={cn("mx-auto w-full", studio ? "max-w-none" : "max-w-5xl")}
          >
            <Outlet />
          </div>
        </main>
      </div>

      <CompanionPanel />
      <VoiceSessionOverlay />

      <TabBar />
      </div>
    </SidebarProvider>
    </LifeAlertsProvider>
    </VoiceProvider>
    </CompanionThreadProvider>
  );
}
