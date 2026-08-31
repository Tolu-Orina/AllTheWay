import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { useT } from "@/app/i18n";
import { Check, Download, FileText, History, Loader2, Pencil, Eye, X } from "lucide-react";

import { api, type ArtifactDetail, type ArtifactPreview, type ArtifactVersion } from "@/app/data";
import { Comments } from "@/app/Comments";
import { ShareControls } from "@/app/Share";
import { FormatToolbar } from "@/app/FormatToolbar";
import { extensionForMime, isOfficeMime, isTextEditableMime } from "@alltheway/contracts";
import { Markdown } from "@/app/Markdown";
import { cn } from "@/lib/utils";

/**
 * The Canvas: the artifact under discussion.
 *
 * ## Why this is a column and not a page
 *
 * In conversation, attention is on the *exchange* — the last thing said. In
 * creative work, attention is on the *object* — the thing being made. Those
 * want opposite layouts: a transcript scrolls away from you, an object stays
 * still. One scrolling thread cannot serve both, which is why chat stops
 * working past a few steps.
 *
 * So the panel keeps its position and changes its noun. No new navigation and
 * nothing to relearn.
 *
 * ## History is a strip, not a modal
 *
 * Seeing that v3 came from "too much blue" is the product's own thesis made
 * visible — corrections are what it learns from. Behind a button, it would be
 * the most interesting thing on the screen and also the most hidden.
 *
 * ## Bytes are fetched, never linked
 *
 * `<img src>` and `<iframe src>` cannot carry an Authorization header, so
 * pointing either at an authenticated endpoint renders a 401 as a broken
 * image. Content is fetched with the token and turned into a blob URL, which
 * this component then owns and revokes.
 *
 * ## Edits persist without a second form
 *
 * Closing the canvas, exporting, or leaving the field writes the draft. A
 * "what changed" note used to sit between the person and that save, so work
 * disappeared when they walked away.
 */

export function Canvas({ artifactId, onClose }: { artifactId: string; onClose?: () => void }) {
  const t = useT();
  const [artifact, setArtifact] = useState<ArtifactDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const draftRef = useRef<string | null>(null);
  const originalRef = useRef("");
  const mimeRef = useRef("text/markdown");
  const savedTitle = useRef("");

  const load = useCallback(
    async (select?: "latest") => {
      const fresh = await api.artifact(artifactId);
      setArtifact(fresh);
      setTitle(fresh.title);
      savedTitle.current = fresh.title;
      setViewing((current) =>
        select === "latest" || current === null ? fresh.currentVersion : current,
      );
      return fresh;
    },
    [artifactId],
  );

  const persist = useCallback(async (): Promise<number | undefined> => {
    const text = draftRef.current;
    if (text === null || text === originalRef.current) return viewing ?? undefined;
    setSaving(true);
    try {
      const { n } = await api.editArtifact(artifactId, text, "", mimeRef.current);
      originalRef.current = text;
      return n;
    } catch {
      return undefined;
    } finally {
      setSaving(false);
    }
  }, [artifactId, viewing]);

  useEffect(() => {
    return () => {
      const text = draftRef.current;
      if (text === null || text === originalRef.current) return;
      void api.editArtifact(artifactId, text, "", mimeRef.current).catch(() => undefined);
    };
  }, [artifactId]);

  useEffect(() => {
    let live = true;
    setArtifact(null);
    setViewing(null);
    setError(null);
    load("latest").catch(() => {
      if (live) setError("That could not be opened.");
    });
    return () => {
      live = false;
    };
  }, [artifactId, load]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-[13.5px] text-muted-foreground">{error}</p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            load("latest").catch(() => setError("That could not be opened."));
          }}
          className="text-[13px] underline"
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  if (!artifact) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2
          className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none"
          aria-label="Opening"
        />
      </div>
    );
  }

  const shown = artifact.versions.find((v) => v.n === viewing) ?? artifact.versions.at(-1);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <label htmlFor="artifact-title" className="sr-only">
            {t("canvas.title")}
          </label>
          <input
            id="artifact-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              const next = title.trim();
              if (!next) {
                setTitle(savedTitle.current);
                return;
              }
              if (next === savedTitle.current) return;
              void api
                .renameArtifact(artifact.id, next)
                .then((row) => {
                  savedTitle.current = row.title;
                  setTitle(row.title);
                  setArtifact((prev) => (prev ? { ...prev, title: row.title } : prev));
                })
                .catch(() => setTitle(savedTitle.current));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="w-full bg-transparent text-[14px] font-semibold outline-none"
          />
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {artifact.versions.length} version{artifact.versions.length === 1 ? "" : "s"}
            {/* Provenance is pixels, not prose. The card version is the
                published contract that produced this — which is what the
                attribution requirement actually asks for, not a build SHA. */}
            {artifact.provenance.cardVersion
              ? ` · ${artifact.provenance.agentId} card ${artifact.provenance.cardVersion}`
              : ""}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <ExportButton
            artifactId={artifact.id}
            version={shown?.n}
            title={title.trim() || artifact.title}
            mimeType={shown?.mimeType}
            persist={persist}
            draft={() => draftRef.current}
            mime={() => mimeRef.current}
          />
          {onClose ? (
            <button
              type="button"
              aria-label={t("canvas.close")}
              onClick={() => {
                void (async () => {
                  await persist();
                  if (draftRef.current !== null && draftRef.current !== originalRef.current) {
                    setError("That did not save. Nothing changed.");
                    return;
                  }
                  onClose();
                })();
              }}
              className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>

      <VersionStrip
        versions={artifact.versions}
        viewing={shown?.n ?? 1}
        current={artifact.currentVersion}
        onSelect={setViewing}
      />

      <ArtifactBody
        artifactId={artifact.id}
        kind={artifact.kind}
        version={shown}
        saving={saving}
        onSave={persist}
        draftRef={draftRef}
        originalRef={originalRef}
        mimeRef={mimeRef}
      />

      {/* Sharing and discussion live with the artifact, under it, in the column
          that already holds its history. A separate screen would put the
          conversation about a thing somewhere other than the thing. */}
      <ShareControls artifactId={artifact.id} />

      <Comments
        artifactId={artifact.id}
        // The version on screen, never `latest`: a comment must belong to what
        // the person was actually looking at when they wrote it.
        viewingVersion={shown?.n ?? 1}
        canComment
      />
    </div>
  );
}

function downloadBlob(blob: Blob, title: string, version: number, mimeType?: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const ext = extensionForMime(mimeType ?? blob.type);
  a.download = `${title.replace(/[^\w\d\-. ]+/g, "_") || "artifact"}-v${version}${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Export downloads through an authenticated fetch, then a transient link. */
function ExportButton({
  artifactId,
  version,
  title,
  mimeType,
  persist,
  draft,
  mime,
}: {
  artifactId: string;
  version: number | undefined;
  title: string;
  mimeType?: string;
  persist: () => Promise<number | undefined>;
  draft: () => string | null;
  mime: () => string;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const n = await persist();
          const versionToGet = n ?? version;
          try {
            if (!versionToGet) throw new Error("no version");
            const blob = await api.artifactBytes(artifactId, versionToGet);
            downloadBlob(blob, title, versionToGet, mimeType ?? mime());
          } catch {
            const text = draft();
            if (text == null) return;
            const type = (mimeType ?? mime()) || "text/markdown";
            downloadBlob(new Blob([text], { type }), title, versionToGet ?? 1, type);
          }
        } finally {
          setBusy(false);
        }
      }}
      className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] transition-colors hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      ) : (
        <Download className="size-3.5" aria-hidden="true" />
      )}
      Export
    </button>
  );
}

/**
 * The history strip.
 *
 * Oldest first, left to right, because that is the order the work happened in.
 * The correction that produced each version is its tooltip — the "why", one
 * hover away, without taking space from the artifact itself.
 */
function VersionStrip({
  versions,
  viewing,
  current,
  onSelect,
}: {
  versions: ArtifactVersion[];
  viewing: number;
  current: number;
  onSelect: (n: number) => void;
}) {
  if (versions.length <= 1) return null;

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto border-b px-4 py-2">
      <History className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      {versions.map((v) => (
        <button
          key={v.n}
          type="button"
          onClick={() => onSelect(v.n)}
          title={v.correction || v.prompt || `Version ${v.n}`}
          aria-current={v.n === viewing ? "true" : undefined}
          className={cn(
            "shrink-0 rounded-full border px-2.5 py-1 text-[12px] tabular-nums transition-colors",
            v.n === viewing
              ? "border-primary/50 bg-primary/10 text-foreground"
              : "text-muted-foreground hover:border-primary/30",
          )}
        >
          v{v.n}
          {v.n === current ? <Check className="ml-1 inline size-3" aria-label="current" /> : null}
        </button>
      ))}
    </div>
  );
}

function ArtifactBody({
  artifactId,
  kind,
  version,
  saving,
  onSave,
  draftRef,
  originalRef,
  mimeRef,
}: {
  artifactId: string;
  kind: ArtifactDetail["kind"];
  version: ArtifactVersion | undefined;
  saving: boolean;
  onSave: () => Promise<number | undefined>;
  draftRef: { current: string | null };
  originalRef: { current: string };
  mimeRef: { current: string };
}) {
  const t = useT();
  const [text, setText] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState(true);
  const area = useRef<HTMLTextAreaElement>(null);

  function write(next: string) {
    draftRef.current = next;
    setText(next);
  }

  useEffect(() => {
    if (!version) return;
    let live = true;
    let created: string | null = null;
    mimeRef.current = version.mimeType || "text/markdown";

    if (kind === "image" || kind === "video" || version.mimeType === "application/pdf") {
      api.artifactBytes(artifactId, version.n).then((blob) => {
        if (!live) return;
        created = URL.createObjectURL(blob);
        setImageUrl(created);
      });
    } else if (!isOfficeMime(version.mimeType)) {
      api.artifactText(artifactId, version.n).then((body) => {
        if (!live) return;
        originalRef.current = body;
        draftRef.current = body;
        setText(body);
        setEditing(!body.trim());
      });
    }

    return () => {
      live = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [artifactId, kind, version, draftRef, originalRef, mimeRef]);

  if (!version) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <FileText className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-[13.5px] font-medium">Nothing in this yet</p>
        <p className="max-w-[22rem] text-[12.5px] leading-relaxed text-muted-foreground">
          {t("canvas.askForADraftInThe")}
        </p>
      </div>
    );
  }

  if (isOfficeMime(version.mimeType)) {
    return <OfficePreviewBody artifactId={artifactId} version={version} />;
  }

  if (version.mimeType === "application/pdf") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {imageUrl ? (
          <iframe
            src={imageUrl}
            title={`Version ${version.n}`}
            className="min-h-0 w-full flex-1 border-0"
          />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <Loader2
              className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none"
              aria-label="Opening"
            />
          </div>
        )}
        <p className="border-t px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
          {t("work.officeEditHint")}
        </p>
      </div>
    );
  }

  if (kind === "image" || kind === "video") {
    return (
      <div className="flex-1 overflow-y-auto p-4">
        {imageUrl ? (
          <figure className="flex flex-col gap-2">
            {kind === "video" ? (
              // A video in an <img> renders as a broken image, which is how
              // this branch behaved until the first generated video existed to
              // show it.
              <video
                src={imageUrl}
                controls
                playsInline
                className="w-full rounded-brand border"
                aria-label={`Version ${version.n}`}
              />
            ) : (
              <img
                src={imageUrl}
                alt={`Version ${version.n}`}
                className="w-full rounded-brand border"
              />
            )}
            {version.producedBy === "agent" ? (
              // FR-M1. Stated on the surface rather than left to the file's
              // metadata: content credentials travel with the bytes and answer
              // the question later, but the person looking at it now is the one
              // deciding whether to send it on.
              <figcaption className="text-[12px] leading-relaxed text-muted-foreground">
                {t("canvas.generatedByAllthewayThisFileCarrie")}
              </figcaption>
            ) : null}
          </figure>
        ) : (
          <Loader2 className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="Loading" />
        )}
        {version.correction ? <Correction note={version.correction} /> : null}
      </div>
    );
  }

  const markdown = isTextEditableMime(version.mimeType);

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        {markdown && editing ? (
          <FormatToolbar
            value={text ?? ""}
            onChange={write}
            textarea={area}
            disabled={text === null || saving}
          />
        ) : (
          <span />
        )}
        {markdown ? (
          <button
            type="button"
            onClick={() => {
              if (editing) void onSave();
              setEditing((v) => !v);
            }}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            {editing ? (
              <>
                <Eye className="size-4" aria-hidden="true" />
                {t("canvas.preview")}
              </>
            ) : (
              <>
                <Pencil className="size-4" aria-hidden="true" />
                {t("canvas.edit")}
              </>
            )}
          </button>
        ) : null}
      </div>

      {markdown && !editing ? (
        text === null ? (
          <Loader2
            className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none"
            aria-label="Loading"
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto rounded-brand border bg-background p-3">
            <Markdown>{text}</Markdown>
          </div>
        )
      ) : (
        <>
          <label htmlFor="canvas-body" className="sr-only">
            {t("canvas.artifactContent")}
          </label>
          <textarea
            ref={area}
            id="canvas-body"
            value={text ?? ""}
            disabled={text === null || saving}
            onChange={(e) => write(e.target.value)}
            spellCheck
            className="min-h-[14rem] w-full flex-1 resize-none rounded-brand border bg-background p-3 font-mono text-[13px] leading-relaxed outline-none disabled:opacity-60"
          />
        </>
      )}
      {version.correction ? <Correction note={version.correction} /> : null}
    </div>
  );
}

function OfficePreviewBody({
  artifactId,
  version,
}: {
  artifactId: string;
  version: ArtifactVersion;
}) {
  const t = useT();
  const [preview, setPreview] = useState<ArtifactPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setPreview(null);
    setError(null);
    api
      .artifactPreview(artifactId, version.n)
      .then((data) => {
        if (live) setPreview(data);
      })
      .catch(() => {
        if (live) setError("That could not be opened.");
      });
    return () => {
      live = false;
    };
  }, [artifactId, version.n]);

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-[13.5px] text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2
          className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none"
          aria-label="Opening"
        />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {preview.format === "word" ? (
        <div className="space-y-3">
          {(preview.paragraphs ?? []).map((p, i) => (
            <p key={`${i}-${p.slice(0, 24)}`} className="text-[14px] leading-relaxed">
              {p}
            </p>
          ))}
        </div>
      ) : null}

      {preview.format === "sheet"
        ? (preview.sheets ?? []).map((sheet) => (
            <div key={sheet.name} className="mb-4 overflow-x-auto">
              <p className="mb-2 text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">
                {sheet.name}
              </p>
              <table className="w-full border-collapse text-[13px]">
                <tbody>
                  {sheet.rows.map((row, r) => (
                    <tr key={r} className="border-b">
                      {row.map((cell, c) => (
                        <td
                          key={`${r}-${c}`}
                          className={cn(
                            "border-r px-2.5 py-1.5",
                            r === 0 && "font-semibold",
                          )}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        : null}

      {preview.format === "slides" ? (
        <ol className="space-y-3">
          {(preview.slides ?? []).map((slide, i) => (
            <li key={`${slide.title}-${i}`} className="overflow-hidden rounded-brand border bg-background">
              {slide.image ? (
                <img
                  src={slide.image}
                  alt=""
                  className="aspect-video w-full object-cover"
                />
              ) : null}
              <div className="p-3">
                <p className="text-[13px] font-semibold">
                  {i + 1}. {slide.title}
                </p>
                {slide.bullets.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-muted-foreground">
                    {slide.bullets.map((b, j) => (
                      <li key={`${j}-${b.slice(0, 24)}`}>{b}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      <p className="mt-4 text-[12.5px] leading-relaxed text-muted-foreground">
        {t("work.officeEditHint")}
      </p>
      {version.correction ? <Correction note={version.correction} /> : null}
    </div>
  );
}

function Correction({ note }: { note: string }) {
  return (
    <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
      <span className="font-medium text-foreground">You said:</span> {note}
    </p>
  );
}

/**
 * Shared-with-me and bookmarks open an artifact as a page. The pane still
 * owns the in-work view; this is the same object without the companion chrome.
 */
export function ArtifactScreen() {
  const { id = "" } = useParams();
  if (!id) return null;
  return (
    <div className="min-h-[28rem] overflow-hidden rounded-brand-lg border bg-card">
      <Canvas artifactId={id} />
    </div>
  );
}

