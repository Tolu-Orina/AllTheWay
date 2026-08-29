import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { ArtifactModal } from "@/app/work/ArtifactModal";
import { CurrentWorkPanel } from "@/app/work/CurrentWorkPanel";
import { WorkChat } from "@/app/work/WorkChat";
import { api } from "@/app/data";

/**
 * Work: a chat (70%) and the current session's trail (30%).
 *
 * `/app/work` is a new chat — previous threads sit in the rail, artifacts
 * are empty. `/app/work/:id` is that session, continued. New in the top bar
 * still allocates a row; typing here does the same on send.
 */
export default function Work() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [openArtifact, setOpenArtifact] = useState<{ session: string; artifact: string } | null>(
    null,
  );
  const [artifactTick, setArtifactTick] = useState(0);

  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    let cancelled = false;
    void (async () => {
      try {
        const created = await api.createSession();
        if (!cancelled) navigate(`/app/work/${created.id}`, { replace: true });
      } catch {
        if (!cancelled) setSearchParams({}, { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, searchParams, setSearchParams]);

  const viewing = openArtifact && openArtifact.session === id ? openArtifact.artifact : null;

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
      <WorkChat sessionId={id} onSettled={() => setArtifactTick((n) => n + 1)} />
      <CurrentWorkPanel
        sessionId={id}
        artifactTick={artifactTick}
        onOpenArtifact={(artifact) => {
          if (id) setOpenArtifact({ session: id, artifact });
        }}
      />
      <ArtifactModal artifactId={viewing} onClose={() => setOpenArtifact(null)} />
    </div>
  );
}
