import { useEffect } from "react";
import { useT } from "@/app/i18n";

import { Button } from "@/components/ui/button";
import { Link } from "@/components/primitives/app-link";
import { LogoMark } from "@/components/primitives/logo";

export default function OfflinePage() {
  const t = useT();
  useEffect(() => {
    document.title = "Offline · AllTheWay";
  }, []);

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="max-w-[26rem] text-center">
        <LogoMark className="mx-auto size-12" />
        <h1 className="mt-6 text-[28px] font-semibold tracking-[-0.015em]">
          {t("common.youAreOffline")}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
          {t("common.allthewayCouldNotReachTheNetwork")}
        </p>
        <Button
          render={<Link href="/" />}
          variant="brand"
          size="xl"
          className="mt-8"
        >
          {t("common.retry")}
        </Button>
      </div>
    </main>
  );
}
