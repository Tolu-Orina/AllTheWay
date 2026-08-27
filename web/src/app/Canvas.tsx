import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { useT } from "@/app/i18n";
import { Check, Download, FileText, History, Loader2 } from "lucide-react";

import { api, type ArtifactDetail, type ArtifactVersion } from "@/app/data";
import { Comments } from "@/app/Comments";
import { ShareControls } from "@/app/Share";
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
 * ## What a correction means before Phase C
 *
 * The agent cannot yet regenerate — that arrives with image generation. Until
 * then a correction is a **user edit**: you change the text and say what
 * changed. The note is kept because it is the learning signal, and Phase C
 * turns the same note into a regeneration instruction without changing the
 * data model.
 */

export function Canvas({ artifactId }: { artifactId: string }) {
  const t = useT();
  const [artifact, setArtifact] = useState<ArtifactDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async (select?: "latest") => {
      const fresh = await api.artifact(artifactId);
      setArtifact(fresh);
      setViewing((current) =>
        select === "latest" || current === null ? fresh.currentVersion : current,
      );
      return fresh;
    },
    [artifactId],
  );

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
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-[14px] font-semibold">{artifact.title}</h2>
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

        <ExportButton artifactId={artifact.id} version={shown?.n} title={artifact.title} />
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
        onSave={async (content, note) => {
          setSaving(true);
          try {
            await api.editArtifact(artifact.id, content, note, shown?.mimeType);
            // Re-read rather than assuming. An optimistic version number that
            // turns out wrong is worse than a moment of latency.
            await load("latest");
          } catch {
            setError("That did not save. Nothing changed.");
          } finally {
            setSaving(false);
          }
        }}
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

/** Export downloads through an authenticated fetch, then a transient link. */
function ExportButton({
  artifactId,
  version,
  title,
}: {
  artifactId: string;
  version: number | undefined;
  title: string;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={!version || busy}
      onClick={async () => {
        if (!version) return;
        setBusy(true);
        try {
          const blob = await api.artifactBytes(artifactId, version);
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${title.replace(/[^\w\d\-. ]+/g, "_") || "artifact"}-v${version}`;
          a.click();
          // Revoked on the next tick: revoking synchronously can cancel the
          // download in some browsers before it has started reading.
          setTimeout(() => URL.revokeObjectURL(url), 0);
        } finally {
          setBusy(false);
        }
      }}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] transition-colors hover:border-primary/40 disabled:opacity-50"
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
}: {
  artifactId: string;
  kind: ArtifactDetail["kind"];
  version: ArtifactVersion | undefined;
  saving: boolean;
  onSave: (content: string, note: string) => void;
}) {
  const t = useT();
  const [text, setText] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const original = useRef<string>("");

  useEffect(() => {
    if (!version) return;
    let live = true;
    let created: string | null = null;

    if (kind === "image" || kind === "video") {
      api.artifactBytes(artifactId, version.n).then((blob) => {
        if (!live) return;
        created = URL.createObjectURL(blob);
        setImageUrl(created);
      });
    } else {
      api.artifactText(artifactId, version.n).then((body) => {
        if (!live) return;
        original.current = body;
        setText(body);
      });
    }

    return () => {
      live = false;
      // This component created the URL, so this component revokes it.
      if (created) URL.revokeObjectURL(created);
    };
  }, [artifactId, kind, version]);

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

  const changed = text !== null && text !== original.current;

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4">
        <label htmlFor="canvas-body" className="sr-only">
          {t("canvas.artifactContent")}
        </label>
        <textarea
          id="canvas-body"
          value={text ?? ""}
          disabled={text === null || saving}
          onChange={(e) => setText(e.target.value)}
          spellCheck
          className="h-full min-h-[14rem] w-full resize-none rounded-brand border bg-background p-3 font-mono text-[13px] leading-relaxed outline-none disabled:opacity-60"
        />
        {version.correction ? <Correction note={version.correction} /> : null}
      </div>

      {/* Correcting is the primary action, so it sits where the message
          composer sits in the conversation view. The muscle memory transfers. */}
      <form
        className="flex items-center gap-2 border-t p-3"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!changed || saving || text === null) return;
          onSave(text, note.trim());
          setNote("");
        }}
      >
        <label htmlFor="canvas-note" className="sr-only">
          {t("canvas.whatChanged")}
        </label>
        <input
          id="canvas-note"
          value={note}
          disabled={saving}
          onChange={(e) => setNote(e.target.value)}
          placeholder={changed ? "What changed?" : "Edit above, then say what changed"}
          className="min-w-0 flex-1 rounded-full border bg-background px-3.5 py-2 text-[13.5px] outline-none placeholder:text-muted-foreground disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!changed || saving}
          aria-label="Save a new version"
          className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <Check className="size-4" aria-hidden="true" />
          )}
        </button>
      </form>
    </>
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

