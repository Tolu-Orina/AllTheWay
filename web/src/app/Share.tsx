import { useState } from "react";
import { useT } from "@/app/i18n";
import { Loader2, Trash2, UserPlus } from "lucide-react";

import { Async } from "@/app/async";
import { useAsync } from "@/app/use-async";
import { api, type Share } from "@/app/data";

/**
 * Sharing an artifact with a named person.
 *
 * ## A role grant, never a public link
 *
 * There is no "anyone with the link" here, and its absence is the design. A URL
 * that works for whoever holds it cannot be revoked from the person who
 * forwarded it and cannot say who read it — a different security model from
 * everything else in this product, bolted on at the one place people share.
 *
 * The cost is real: you cannot share with someone who has not signed in. That
 * is stated plainly rather than worked around, because the workaround is the
 * link.
 *
 * ## Access is shown, not implied
 *
 * The list of who can see this is visible to the owner at all times. A sharing
 * control that only ever adds is how people end up not knowing who has their
 * work.
 */
export function ShareControls({ artifactId }: { artifactId: string }) {
  const t = useT();
  const { state, reload } = useAsync<Share[]>(() => api.shares(artifactId));
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "commenter">("viewer");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function grant() {
    const address = email.trim();
    if (!address) return;

    setBusy(true);
    setFailure(null);
    try {
      await api.share(artifactId, address, role);
      setEmail("");
      await reload();
    } catch (err) {
      // Shown verbatim: "sharing is part of the Team plan" and "ask them to
      // sign in first" are both actionable, and a generic failure is not.
      setFailure((err as { message?: string }).message ?? "That could not be shared.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 border-t p-4">
      <h3 className="text-[12px] font-semibold tracking-[0.08em] text-blue-deep uppercase dark:text-blue-bright">
        {t("share.heading")}
      </h3>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`share-${artifactId}`} className="sr-only">
          {t("share.emailAddressToShareWith")}
        </label>
        <input
          id={`share-${artifactId}`}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("share.placeholder")}
          className="min-w-0 flex-1 rounded-brand border bg-background px-3 py-1.5 text-[13px] outline-none placeholder:text-muted-foreground"
        />
        <label htmlFor={`role-${artifactId}`} className="sr-only">
          {t("share.whatTheyCanDo")}
        </label>
        <select
          id={`role-${artifactId}`}
          value={role}
          onChange={(e) => setRole(e.target.value as "viewer" | "commenter")}
          className="rounded-brand border bg-background px-2 py-1.5 text-[13px]"
        >
          <option value="viewer">{t("share.canView")}</option>
          <option value="commenter">{t("share.canComment")}</option>
        </select>
        <button
          type="button"
          onClick={grant}
          disabled={busy || !email.trim()}
          className="flex items-center gap-1.5 rounded-brand bg-primary px-3 py-1.5 text-[13px] text-primary-foreground disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <UserPlus className="size-3.5" aria-hidden="true" />
          )}
          {t("share.heading")}
        </button>
      </div>

      <p className="text-[12px] leading-relaxed text-muted-foreground">
        {t("share.hint")}
      </p>

      {failure ? (
        <p role="alert" className="text-[12.5px] text-destructive">
          {failure}
        </p>
      ) : null}

      <Async
        state={state}
        reload={reload}
        isEmpty={(rows) => rows.length === 0}
        empty={
          <p className="text-[12.5px] text-muted-foreground">
            {t("share.nobody")}
          </p>
        }
      >
        {(rows) => (
          <ul className="flex flex-col gap-1.5">
            {rows.map((s) => (
              <li
                key={s.granteeUid}
                className="flex items-center justify-between gap-3 text-[13px]"
              >
                <span className="min-w-0 truncate">
                  {s.granteeEmail}
                  <span className="ml-1.5 text-[12px] text-muted-foreground">
                    {s.role === "commenter" ? "can comment" : "can view"}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`Remove access for ${s.granteeEmail}`}
                  onClick={async () => {
                    await api.revokeShare(artifactId, s.granteeUid);
                    await reload();
                  }}
                  className="grid size-7 shrink-0 place-items-center rounded-brand text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Async>
    </section>
  );
}
