import { useCallback, useRef, useState } from "react";
import { useT } from "@/app/i18n";
import { Camera, Loader2, ShieldAlert, Trash2, Upload } from "lucide-react";

import { Async } from "@/app/async";
import { useAsync } from "@/app/use-async";
import { api, type UserDocument } from "@/app/data";
import { useCompanionThread } from "@/app/companion-thread";
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_CAMERA_ACCEPT,
  DOCUMENT_MAX_BYTES,
  prepareDocumentUpload,
} from "@/lib/document-file";
import { cn } from "@/lib/utils";

export { DOCUMENT_ACCEPT, DOCUMENT_CAMERA_ACCEPT, DOCUMENT_MAX_BYTES };

/**
 * The document library.
 *
 * ## Ingestion is visible, because it is slow and can refuse
 *
 * A 40-page contract takes a while: extract, screen, chunk, embed, index. A
 * spinner that says nothing for ninety seconds reads as broken. So the status
 * is shown as the pipeline's own stages — and a refusal is shown as a refusal,
 * in words, not as a failure.
 *
 * `blocked` is the state worth designing for. Screening refusing a document is
 * the system working, and a user who sees "that could not be processed" learns
 * nothing, while one who sees "this document tries to give instructions" learns
 * exactly the right thing.
 *
 * ## Deleting says what it removed
 *
 * FR-D3: deletion removes the embeddings, not just the file. A document you
 * deleted that still answers questions is not deleted, and the only way a user
 * can believe that happened is if the interface says so.
 */

/**
 * After a successful upload, one turn. This is a user message, not chrome —
 * the planner reads it — so it stays English on purpose.
 */
export function askAboutAdded(name: string): string {
  return `I've added ${name}. Start with the densest or most consequential part and cite it.`;
}

const STATUS: Record<UserDocument["status"], { label: string; tone: string }> = {
  screening: { label: "Screening", tone: "text-muted-foreground" },
  indexing: { label: "Indexing", tone: "text-muted-foreground" },
  ready: { label: "Ready", tone: "text-muted-foreground" },
  blocked: { label: "Not accepted", tone: "text-destructive" },
};

export function DocumentPickup({ onUploaded }: { onUploaded?: (name: string, documentId?: string) => void }) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [docName, setDocName] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const file = Array.from(files)[0];
      if (!file) return;

      setError(null);
      const fallback = file.name?.trim() || (file.type.startsWith("image/") ? "photo" : "document");
      // Use whatever the user typed; fall back to the file's own name
      const title = docName.trim() || fallback;
      setBusy(title);
      try {
        const prepared = await prepareDocumentUpload(file);
        const result = await api.uploadDocument(title, prepared.content, prepared.mimeType);
        setDocName("");
        onUploaded?.(title, result.documentId);
      } catch (err) {
        const message = (err as { message?: string }).message;
        setError(message || "That document could not be added.");
      } finally {
        setBusy(null);
      }
    },
    [onUploaded, docName],
  );

  return (
    <>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center gap-2 rounded-brand border border-dashed px-4 py-6 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-muted-foreground/30",
        )}
      >
        <Upload className="size-5 text-muted-foreground" aria-hidden="true" />
        <p className="text-[13px]">
          {t("documents.drop")}{" "}
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="underline underline-offset-2"
          >
            {t("documents.choose")}
          </button>
        </p>
        <p className="text-[12px] text-muted-foreground">{t("documents.types")}</p>
        <input
          ref={input}
          type="file"
          accept={DOCUMENT_ACCEPT}
          className="sr-only"
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={camera}
          type="file"
          accept={DOCUMENT_CAMERA_ACCEPT}
          capture="environment"
          className="sr-only"
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => camera.current?.click()}
          className="hidden items-center gap-1.5 rounded-brand border px-3 py-1.5 text-[12.5px] transition-colors hover:bg-muted [@media(pointer:coarse)]:inline-flex"
        >
          <Camera className="size-3.5" aria-hidden="true" />
          {t("documents.photograph")}
        </button>
      </div>

      <input
        type="text"
        value={docName}
        onChange={(e) => setDocName(e.target.value)}
        placeholder={t("documents.namePlaceholder")}
        className="w-full rounded-brand border bg-background px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground"
        aria-label={t("documents.namePlaceholder")}
      />
      <p className="text-[12px] text-muted-foreground">{t("documents.organiseHint")}</p>

      {busy ? (
        <p role="status" className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {t("documents.reading", { name: busy })}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-[12.5px] text-destructive">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </>
  );
}

export function Documents() {
  const t = useT();
  const { state, reload } = useAsync(() => api.documents());

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[12px] font-semibold tracking-[0.08em] text-blue-deep uppercase dark:text-blue-bright">
        {t("documents.heading")}
      </h2>
      <p className="text-[13.5px] leading-relaxed text-muted-foreground">
        {t("documents.intro")}
      </p>

      <DocumentPickup onUploaded={reload} />

      <Async
        state={state}
        reload={reload}
        isEmpty={(d) => d.documents.length === 0}
        empty={
          <p className="py-4 text-[12.5px] text-muted-foreground">
            {t("documents.none")}
          </p>
        }
      >
        {(data) => (
          <ul className="flex flex-col gap-2">
            {data.documents.map((doc) => (
              <DocumentRow key={doc.id} document={doc} onDeleted={reload} />
            ))}
          </ul>
        )}
      </Async>
    </section>
  );
}

function DocumentRow({
  document,
  onDeleted,
}: {
  document: UserDocument;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const { send, working } = useCompanionThread();
  const t = useT();
  const status = STATUS[document.status];
  const blocked = document.status === "blocked";
  const ready = document.status === "ready";

  return (
    <li
      className={cn(
        "flex items-start justify-between gap-3 rounded-brand border bg-card px-3.5 py-3",
        blocked && "border-destructive/40 bg-destructive/5",
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-[13.5px] font-medium">{document.title}</p>
        <p className={cn("mt-0.5 text-[12px]", status.tone)}>
          {status.label}
          {document.status === "ready" && document.pages
            ? ` · ${document.pages} page${document.pages === 1 ? "" : "s"}`
            : ""}
        </p>
        {blocked && document.blockedReason ? (
          // Verbatim from screening. It names the rule, never the matched text
          // — repeating an injection here would hand the attack a second route.
          <p className="mt-1.5 text-[12px] leading-relaxed text-destructive">
            {document.blockedReason}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {ready ? (
          <button
            type="button"
            disabled={working}
            onClick={() => send(askAboutAdded(document.title))}
            className="rounded-brand px-2 py-1 text-[12.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {t("documents.askAboutThis")}
          </button>
        ) : null}
        <button
          type="button"
          disabled={deleting}
          aria-label={`Delete ${document.title}`}
          onClick={async () => {
            setDeleting(true);
            try {
              await api.deleteDocument(document.id);
              onDeleted();
            } finally {
              setDeleting(false);
            }
          }}
          className="grid size-8 shrink-0 place-items-center rounded-brand text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          {deleting ? (
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <Trash2 className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
    </li>
  );
}

