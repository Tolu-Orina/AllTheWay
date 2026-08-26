import { useState } from "react";
import { Check, MessageSquare } from "lucide-react";

import { Async } from "@/app/async";
import { useAsync } from "@/app/use-async";
import { api, type Comment } from "@/app/data";
import { cn } from "@/lib/utils";

/**
 * Comments on an artifact, anchored to the version they were written about.
 *
 * ## Why the anchor is shown, not just stored
 *
 * A comment on v2 read while looking at v5 is not wrong — it is *about
 * something else*. Storing the anchor prevents the data from lying; showing it
 * prevents the reader from being misled. Without the label, "this clause
 * contradicts section 4" next to a paragraph that no longer says that makes the
 * commenter look careless, when in truth the document moved under them.
 *
 * Comments about the version on screen are shown plainly. Comments about an
 * older one are dimmed and labelled, present but visibly not about this.
 *
 * ## Resolving is not deleting
 *
 * A resolved comment stays, greyed. The question after a disagreement is
 * usually "what did we decide and why", and a thread that erases itself as it
 * is settled cannot answer it.
 */
export function Comments({
  artifactId,
  viewingVersion,
  owner,
  canComment,
}: {
  artifactId: string;
  viewingVersion: number;
  /** Present when reading someone else's artifact. */
  owner?: string;
  canComment: boolean;
}) {
  const { state, reload } = useAsync<Comment[]>(() => api.comments(artifactId, owner));
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const body = draft.trim();
    if (!body) return;

    setBusy(true);
    try {
      // Anchored to what is on screen right now, not to `latest`. If the
      // artifact gains a version between opening and sending, the comment still
      // belongs to what the person was actually looking at.
      await api.comment(artifactId, viewingVersion, body, owner);
      setDraft("");
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 border-t p-4">
      <h3 className="flex items-center gap-1.5 text-[12px] font-semibold tracking-[0.08em] text-blue-deep uppercase dark:text-blue-bright">
        <MessageSquare className="size-3.5" aria-hidden="true" />
        Comments
      </h3>

      <Async
        state={state}
        reload={reload}
        isEmpty={(rows) => rows.length === 0}
        empty={<p className="text-[12.5px] text-muted-foreground">No comments yet.</p>}
      >
        {(rows) => (
          <ul className="flex flex-col gap-2.5">
            {rows.map((c) => {
              const aboutThis = c.versionAnchor === viewingVersion;
              return (
                <li
                  key={c.id}
                  className={cn(
                    "rounded-brand border px-3 py-2.5",
                    c.resolved && "opacity-60",
                    !aboutThis && "border-dashed",
                  )}
                >
                  <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
                    <span className="font-medium text-foreground">{c.authorEmail}</span>
                    {aboutThis ? null : (
                      // Present, and visibly not about what is on screen.
                      <span>on version {c.versionAnchor}</span>
                    )}
                    {c.resolved ? <span>· resolved</span> : null}
                  </p>
                  <p className="mt-1 text-[13.5px] leading-relaxed">{c.body}</p>

                  {!c.resolved && canComment ? (
                    <button
                      type="button"
                      onClick={async () => {
                        await api.resolveComment(artifactId, c.id, owner);
                        await reload();
                      }}
                      className="mt-1.5 flex items-center gap-1 text-[12px] text-muted-foreground underline-offset-2 hover:underline"
                    >
                      <Check className="size-3.5" aria-hidden="true" />
                      Resolve
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Async>

      {canComment ? (
        <div className="flex items-end gap-2">
          <label htmlFor={`comment-${artifactId}`} className="sr-only">
            Add a comment
          </label>
          <textarea
            id={`comment-${artifactId}`}
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Comment on version ${viewingVersion}…`}
            className="min-w-0 flex-1 resize-none rounded-brand border bg-background px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={submit}
            disabled={busy || !draft.trim()}
            className="rounded-brand bg-primary px-3 py-2 text-[13px] text-primary-foreground disabled:opacity-50"
          >
            Send
          </button>
        </div>
      ) : (
        <p className="text-[12px] text-muted-foreground">
          You have view-only access to this.
        </p>
      )}
    </section>
  );
}
