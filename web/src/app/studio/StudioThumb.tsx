import { useEffect, useState } from "react";

import { api, type Artifact } from "@/app/data";
import { cn } from "@/lib/utils";

/**
 * Thumbnail for a studio artifact. Bytes are fetched with the token and
 * turned into a blob URL — `<img src>` cannot carry Authorization.
 */
export function StudioThumb({
  artifact,
  selected,
  onSelect,
  label,
}: {
  artifact: Artifact;
  selected: boolean;
  onSelect: () => void;
  label: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let created: string | null = null;
    void api
      .artifactBytes(artifact.id, artifact.currentVersion)
      .then((blob) => {
        if (!live) return;
        created = URL.createObjectURL(blob);
        setUrl(created);
      })
      .catch(() => {
        /* broken thumb is a gap, not a crash */
      });
    return () => {
      live = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [artifact.id, artifact.currentVersion]);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      aria-label={label}
      className={cn(
        "relative aspect-square w-full overflow-hidden rounded-brand ring-1 transition-shadow",
        selected
          ? "ring-2 ring-primary shadow-e1"
          : "ring-border/70 hover:ring-primary/40",
      )}
    >
      {url && artifact.kind === "video" ? (
        <video src={url} muted playsInline preload="metadata" className="size-full object-cover" />
      ) : url ? (
        <img src={url} alt="" className="size-full object-cover" />
      ) : (
        <span className="block size-full bg-muted" />
      )}
    </button>
  );
}
