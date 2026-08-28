import { useState } from "react";
import { useT } from "@/app/i18n";

import { Button } from "@/components/ui/button";
import { enablePush, iosNeedsHomeScreen } from "@/app/push";

/**
 * Push opt-in on Today, after she has seen the day or something waiting.
 * Never on load. iOS only delivers after Add to Home Screen.
 */
export function PushOffer({ show }: { show: boolean }) {
  const t = useT();
  const [note, setNote] = useState<string | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const blocked = iosNeedsHomeScreen();
  const permission = typeof Notification === "undefined" ? "default" : Notification.permission;

  async function turnOn() {
    setBusy(true);
    const outcome = await enablePush();
    setBusy(false);
    if (outcome.ok) {
      setOn(true);
      setNote(t("life.pushOn"));
    } else {
      setNote(outcome.reason);
    }
  }

  if (!show || on || permission === "granted" || permission === "denied") return null;

  return (
    <section className="rounded-brand-lg border bg-card p-4 shadow-e1">
      <p className="text-[14px] leading-relaxed">{t("life.pushOffer")}</p>
      {blocked ? (
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{t("life.pushOfferIos")}</p>
      ) : null}
      {note ? (
        <p role="status" className="mt-2 text-[13px] text-muted-foreground">
          {note}
        </p>
      ) : null}
      <Button
        type="button"
        variant="brand"
        size="lg"
        className="mt-3"
        disabled={busy || blocked}
        onClick={() => void turnOn()}
      >
        {t("life.enablePush")}
      </Button>
    </section>
  );
}
