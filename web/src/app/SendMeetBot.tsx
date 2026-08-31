import { useState } from "react";
import { useT } from "@/app/i18n";

import { api } from "@/app/data";
import { ConfirmGate } from "@/app/ConfirmGate";

/**
 * Per-meeting opt-in for the labelled guest. Separate from tab-capture
 * disclosure. Not mounted while finance reviews the join vendor — live notes
 * are Notes from this tab. Keep this file; do not surface it until a vendor
 * key is live.
 */
export function SendMeetBot({ meetUrl }: { meetUrl: string }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  if (!meetUrl) return null;

  return (
    <div className="mt-2">
      {open ? (
        <ConfirmGate
          summary={t("meetings.sendBotConfirm")}
          actions={[
            {
              label: t("meetings.sendBotAction"),
              reason: t("meetings.sendBotReason"),
            },
          ]}
          confirmLabel={busy ? t("meetings.confirming") : t("meetings.sendBot")}
          declineLabel={t("meetings.notThis")}
          busy={busy}
          status={status}
          onConfirm={() => {
            setBusy(true);
            setStatus(null);
            void api
              .startMeetingBot({ meetUrl, disclosed: true })
              .then((result) => {
                setStatus(
                  result.message ?? (result.ok ? t("meetings.knocking") : t("meetings.botVendorPending")),
                );
              })
              .catch((err: unknown) => {
                setStatus(err instanceof Error ? err.message : t("common.saveFailed"));
              })
              .finally(() => setBusy(false));
          }}
          onDecline={() => setOpen(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[12.5px] underline underline-offset-2 text-muted-foreground"
        >
          {t("meetings.sendBot")}
        </button>
      )}
    </div>
  );
}
