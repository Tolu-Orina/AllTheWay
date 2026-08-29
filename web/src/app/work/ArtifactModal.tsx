import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Canvas } from "@/app/Canvas";

/**
 * An artifact, opened in place rather than as a new page.
 *
 * The canvas already knows the type: text is editable, images and video play,
 * Office files preview and download. A modal keeps the Work chat in view.
 */
export function ArtifactModal({
  artifactId,
  onClose,
}: {
  artifactId: string | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={artifactId != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="flex h-[min(88vh,52rem)] max-w-5xl flex-col p-0"
        showCloseButton
      >
        <DialogTitle className="sr-only">Artifact</DialogTitle>
        {artifactId ? (
          <div className="min-h-0 flex-1">
            <Canvas artifactId={artifactId} />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
