import { useState } from "react";
import { useT } from "@/app/i18n";
import type { ProposedCommitment } from "@alltheway/contracts";

import { Button } from "@/components/ui/button";
import { api } from "@/app/data";

export function ProposedCommitments({
  rows,
  onChange,
}: {
  rows: ProposedCommitment[];
  onChange: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);

  if (rows.length === 0) return null;

  async function act(id: string, verb: "accept" | "decline") {
    setBusy(id);
    try {
      if (verb === "accept") await api.acceptProposed(id);
      else await api.declineProposed(id);
      onChange();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="proposed-heading" className="rounded-brand-lg border bg-card p-4 shadow-e1">
      <h2 id="proposed-heading" className="text-[16px] font-semibold">
        {t("life.proposed")}
      </h2>
      <ul className="mt-3 flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0">
            <p className="text-[14px] font-medium">{row.title}</p>
            {row.detail ? (
              <p className="text-[13px] leading-relaxed text-muted-foreground">{row.detail}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="brand"
                size="sm"
                disabled={busy === row.id}
                onClick={() => void act(row.id, "accept")}
              >
                {t("life.accept")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy === row.id}
                onClick={() => void act(row.id, "decline")}
              >
                {t("life.decline")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
