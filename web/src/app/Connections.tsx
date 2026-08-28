import { useState } from "react";
import { useT } from "@/app/i18n";
import { Check, ExternalLink, Loader2 } from "lucide-react";

import { Async } from "@/app/async";
import { useAsync } from "@/app/use-async";
import { api, type Connector } from "@/app/data";
import { cn } from "@/lib/utils";

/**
 * Connected accounts.
 *
 * Two honesty rules, both of which cost something to keep:
 *
 *  - **The list comes from the server.** A connector that is not ready cannot
 *    be made to look ready by editing this file; "coming soon" is a fact about
 *    the backend, not a label.
 *  - **Nothing here claims a connection until the server says so.** Consent is
 *    a round-trip through Google, and the browser cannot know the outcome — so
 *    this navigates away and re-reads on return rather than optimistically
 *    flipping a switch that might be wrong.
 */

/** What Google sent us back with, as a sentence rather than a status code. */
const OUTCOMES: Record<string, { tone: "good" | "bad"; text: string }> = {
  google: { tone: "good", text: "Your Google account is connected." },
  google_calendar: { tone: "good", text: "Google Calendar is connected." },
  google_gmail: { tone: "good", text: "Gmail is connected." },
  google_drive: { tone: "good", text: "Google Drive is connected." },
  google_docs: { tone: "good", text: "Google Docs is connected." },
  google_meet: { tone: "good", text: "Google Meet is connected." },
  expired: {
    tone: "bad",
    text: "That took too long and the request expired. Try connecting again.",
  },
  retry: {
    tone: "bad",
    text: "Google did not return a lasting permission. Try again, and choose Allow on every screen.",
  },
  failed: { tone: "bad", text: "That did not complete. Nothing was connected." },
};

export function Connections() {
  const t = useT();
  const { state, reload } = useAsync(() => api.connectors());
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState(false);

  // Read once from the URL the callback redirected to, then removed — so a
  // refresh does not keep re-announcing a connection that happened minutes ago.
  const [outcome] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("connected");
    if (value) {
      params.delete("connected");
      const query = params.toString();
      window.history.replaceState(
        {},
        "",
        window.location.pathname + (query ? `?${query}` : ""),
      );
    }
    return value ? OUTCOMES[value] : undefined;
  });

  async function connect(connectorId: string) {
    setStarting(connectorId);
    setError(null);
    try {
      const { url } = await api.connectGoogle({ connector: connectorId, drafts });
      // A full navigation, not a popup: Google's consent screen refuses to
      // render in an iframe, and a popup is the thing mobile browsers block.
      window.location.assign(url);
    } catch {
      setStarting(null);
      setError("Could not start connecting. Try again in a moment.");
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[12px] font-semibold tracking-[0.08em] text-blue-deep uppercase dark:text-blue-bright">
        {t("connections.connectedAccounts")}
      </h2>
      <p className="text-[13.5px] leading-relaxed text-muted-foreground">
        {t("connections.whatAllthewayIsAllowedToReach")}
      </p>

      {outcome ? (
        <p
          role="status"
          className={cn(
            "rounded-brand border px-3 py-2 text-[13px]",
            outcome.tone === "good"
              ? "border-primary/30 bg-primary/5"
              : "border-destructive/30 bg-destructive/5",
          )}
        >
          {outcome.text}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}

      {/* Off by default, and says why. Asking for a restricted scope nobody
          needs is how an app ends up owing Google a security assessment. */}
      <label className="flex items-start gap-2.5 rounded-brand border bg-card px-3.5 py-3 text-[13px]">
        <input
          type="checkbox"
          checked={drafts}
          onChange={(e) => setDrafts(e.target.checked)}
          className="mt-0.5 size-4 shrink-0"
        />
        <span>
          <span className="font-medium">Let it save Gmail drafts</span>
          <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted-foreground">
            {t("connections.draftingIsTheSafestThingIt")}
            {t("connections.googleStillClassesThePermissionAs")}
          </span>
        </span>
      </label>

      <Async state={state} reload={reload}>
        {(data) => (
          <ul className="flex flex-col gap-2">
            {data.connectors.map((c) => (
              <ConnectorRow
                key={c.id}
                connector={c}
                busy={starting === c.id}
                onConnect={() => connect(c.id)}
              />
            ))}
          </ul>
        )}
      </Async>
    </section>
  );
}

function ConnectorRow({
  connector,
  busy,
  onConnect,
}: {
  connector: Connector;
  busy: boolean;
  onConnect: () => void;
}) {
  const t = useT();
  const soon = connector.status === "coming_soon";

  return (
    <li
      className={cn(
        "flex items-center justify-between gap-3 rounded-brand border bg-card px-3.5 py-3",
        soon && "opacity-60",
      )}
    >
      <div className="min-w-0">
        <p className="text-[14px] font-medium">{connector.label}</p>
        {connector.connected ? (
          <p className="mt-0.5 flex items-center gap-1 text-[12.5px] text-muted-foreground">
            <Check className="size-3.5" aria-hidden="true" />
            {t("connections.connected")}
          </p>
        ) : null}
      </div>

      {soon ? (
        <span className="shrink-0 rounded-full border px-2.5 py-1 text-[12px] text-muted-foreground">
          {t("connections.comingSoon")}
        </span>
      ) : (
        <button
          type="button"
          onClick={onConnect}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] transition-colors hover:border-primary/40 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <ExternalLink className="size-3.5" aria-hidden="true" />
          )}
          {/* Reconnect, not Connected: the button is still useful once an
              account is linked, because granting a further permission means
              going through consent again. */}
          {connector.connected ? "Reconnect" : "Connect"}
        </button>
      )}
    </li>
  );
}
