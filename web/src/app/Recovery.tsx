import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AlertCircle } from "lucide-react";

import { api } from "@/app/data";
import { routesFor, type FailureKind, type Route } from "@alltheway/contracts";

/**
 * What a person sees when something fails.
 *
 * ## Every failure gets a way forward
 *
 * A failure with no route is where trust is lost: the only remaining move is to
 * leave. The routes come from the shared taxonomy, which the type system will
 * not let anyone leave incomplete.
 *
 * ## The detail is shown, the route is offered
 *
 * The message from the service is displayed verbatim — "your access to this was
 * removed", "sharing is part of the Team plan" — because those are already
 * written for a person. This component adds what to *do*, which is the part a
 * message cannot carry.
 *
 * ## Accessible by construction
 *
 * `role="alert"` so a screen reader is told without waiting for focus, real
 * `<button>`s so every route is keyboard-reachable in order, and focus moves to
 * the group when it appears — a failure the keyboard user has to hunt for is a
 * failure with no route for them.
 */
export function Recovery({
  kind,
  message,
  turnId,
  onRetry,
  onChange,
}: {
  kind: FailureKind;
  /** Verbatim from the service. Already written for a person. */
  message: string;
  turnId: string;
  onRetry?: () => void;
  onChange?: (routeId: string) => void;
}) {
  const navigate = useNavigate();
  const group = useRef<HTMLDivElement>(null);
  const [recoveryId, setRecoveryId] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);

  useEffect(() => {
    group.current?.focus();
    // Written when the routes are shown, not when one is chosen — "offered
    // three and picked none" is the most interesting outcome there is, and an
    // absent row could not express it.
    void api
      .recoveryOffered(turnId, kind)
      .then((r) => setRecoveryId((r as { id?: string }).id ?? null))
      .catch(() => setRecoveryId(null));
  }, [kind, turnId]);

  function take(route: Route) {
    // Recorded before acting. A route that navigates away would otherwise lose
    // the record of having been chosen.
    if (recoveryId) void api.recoveryTaken(recoveryId, route.id).catch(() => {});

    switch (route.kind) {
      case "retry":
        onRetry?.();
        break;
      case "navigate":
        if (route.to) navigate(route.to);
        break;
      case "explain":
        setExplaining((v) => !v);
        break;
      default:
        onChange?.(route.id);
    }
  }

  const routes = routesFor(kind);

  return (
    <div
      ref={group}
      tabIndex={-1}
      role="alert"
      aria-label="Something did not work"
      className="flex flex-col gap-2.5 rounded-brand border border-destructive/40 bg-destructive/5 px-3.5 py-3 outline-none"
    >
      <p className="flex items-start gap-2 text-[13.5px] leading-relaxed">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
        {message}
      </p>

      {explaining ? (
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          {EXPLANATIONS[kind]}
        </p>
      ) : null}

      <ul className="flex flex-wrap gap-2">
        {routes.map((route) => (
          <li key={route.id}>
            <button
              type="button"
              onClick={() => take(route)}
              className="rounded-brand border bg-background px-3 py-1.5 text-[13px] transition-colors hover:bg-muted"
            >
              {route.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What "why?" reveals.
 *
 * Written to answer the question rather than restate the failure. A user who
 * presses "Why was this blocked?" and reads "it was blocked" has been given a
 * button that does nothing.
 */
const EXPLANATIONS: Record<FailureKind, string> = {
  model_unavailable:
    "The model that answers these did not respond. Nothing was done, and nothing was lost.",
  connector_not_connected:
    "This needs access to an account you have not connected yet. It cannot reach anything you have not explicitly allowed.",
  plan_limit: "This month's allowance for this is used up. It resets at the start of next month.",
  screening_blocked:
    "The content contained instructions aimed at the agent rather than at you. That is refused before any model reads it, which is why trying again would be refused the same way.",
  meet_refused:
    "Live meeting notes need every participant enrolled in Google's preview programme. When that is not the case, the transcript is read after the call instead.",
  retrieval_empty:
    "Nothing in your documents matched closely enough to cite. An answer without them is still possible; it just will not be grounded in anything you added.",
  not_confirmed: "Nothing has been done. This needed you to say yes first.",
  above_ceiling:
    "This is more than the agent may do on its own at your current setting. You can allow it once, or change the setting.",
  cost_not_acknowledged:
    "This one costs meaningfully more than a draft, so it asks separately about the price as well as the action.",
  rate_limited: "Too many requests in a short window. This clears on its own within a minute.",
  out_of_scope:
    "The account is connected, but not for this particular thing. Permissions are granted narrowly on purpose.",
  upstream_error: "A service this depends on did not answer. Nothing was half-done.",
  too_large: "The file is larger than this can take in one piece.",
  not_configured:
    "This part of the product is not switched on in this deployment. There is nothing you can change to fix it.",
};
