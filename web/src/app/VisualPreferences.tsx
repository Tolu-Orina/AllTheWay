import { useState } from "react";
import { useT } from "@/app/i18n";
import { Undo2 } from "lucide-react";

import { Async } from "@/app/async";
import { useAsync } from "@/app/use-async";
import { api, type VisualPreference } from "@/app/data";

/**
 * Brand memory, shown as colour rather than as prose.
 *
 * ## Why swatches
 *
 * "Muted, not neon" is a sentence a user cannot check. Six squares are a claim
 * they can disagree with in a second. This is the only part of the Cognitive
 * Profile with a value that can be *seen*, and rendering it as text would throw
 * away the one advantage it has.
 *
 * ## Reverting is immediate and reversible-looking
 *
 * Optimistic, like the learned preferences beside it: the row goes on click and
 * comes back if the write fails. A profile screen that spins is a profile
 * screen people stop opening, and the whole argument for showing this is that
 * it gets looked at.
 */
export function VisualPreferences() {
  const t = useT();
  const { state, reload } = useAsync<VisualPreference[]>(() => api.visualPreferences());
  const [revertedIds, setRevertedIds] = useState<string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);

  async function revert(item: VisualPreference) {
    setFailure(null);
    setRevertedIds((prev) => [...prev, item.id]);
    try {
      await api.revertVisualPreference(item.id);
    } catch {
      setRevertedIds((prev) => prev.filter((id) => id !== item.id));
      setFailure("We could not revert that. Nothing changed — try again.");
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[12px] font-semibold tracking-[0.08em] text-blue-deep uppercase dark:text-blue-bright">
        {t("visual.howYourWorkLooks")}
      </h2>
      <p className="text-[13.5px] leading-relaxed text-muted-foreground">
        {t("visual.whatItHasPickedUpAbout")}
      </p>

      {failure ? (
        <p role="alert" className="text-[12.5px] text-destructive">
          {failure}
        </p>
      ) : null}

      <Async
        state={state}
        reload={reload}
        isEmpty={(rows) => rows.filter((r) => !revertedIds.includes(r.id)).length === 0}
        empty={
          <p className="py-4 text-[12.5px] text-muted-foreground">
            {t("visual.nothingYetAskItToMake")}
          </p>
        }
      >
        {(rows) => (
          <ul className="flex flex-col gap-2">
            {rows
              .filter((r) => !revertedIds.includes(r.id))
              .map((item) => (
                <li
                  key={item.id}
                  className="flex items-start justify-between gap-3 rounded-brand border bg-card px-3.5 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-[12px] tracking-[0.06em] text-muted-foreground uppercase">
                      {item.aspect}
                    </p>
                    <p className="mt-0.5 text-[13.5px]">{item.value}</p>

                    {item.swatches.length > 0 ? (
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {item.swatches.map((hex) => (
                          <li
                            key={hex}
                            // The hex is the label, not a tooltip: a swatch
                            // nobody can name is a swatch nobody can ask for
                            // again, and colour alone fails anyone who cannot
                            // distinguish these two greens.
                            className="flex items-center gap-1.5 rounded-full border py-0.5 pr-2 pl-1"
                          >
                            <span
                              aria-hidden="true"
                              className="size-3.5 rounded-full border"
                              style={{ backgroundColor: hex }}
                            />
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {hex}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                      {item.evidence}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => revert(item)}
                    aria-label={`Revert ${item.aspect}`}
                    className="flex shrink-0 items-center gap-1.5 rounded-brand border px-2.5 py-1.5 text-[12.5px] transition-colors hover:bg-muted"
                  >
                    <Undo2 className="size-3.5" aria-hidden="true" />
                    Revert
                  </button>
                </li>
              ))}
          </ul>
        )}
      </Async>
    </section>
  );
}
