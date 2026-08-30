import type { ArtifactDetail } from "@alltheway/contracts";

import { createArtifact } from "./repos/artifacts.js";
import { readUsage, recordUsage } from "./repos/usage.js";
import { storageConfigured } from "./storage.js";
import { compileWorkFile } from "./document-quality.js";
import { documentCellUrl, invokeDocumentCell } from "./document-client.js";
import { generateStill } from "./document-images.js";
import { critiqueDeck, vertexVision } from "./document-critic.js";
import { vertexPlanner } from "./document-planner.js";
import {
  WORK_FILES_CONNECTOR,
  isWorkFilesTool,
  officeFileLabel,
} from "./office-mime.js";

export type WorkFilesStep = {
  label?: string;
  connector?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
};

export type WorkFilesOutcome = {
  label: string;
  connector: string;
  tool: string;
  did: string;
  detail: string;
};

/**
 * Confirmed work_files steps: build the Office file here, persist it as a
 * session artifact. No connector, no OAuth — same pattern as persisting a
 * generated still, without a third-party account.
 */

export function isWorkFilesStep(step: WorkFilesStep): boolean {
  return step.connector === WORK_FILES_CONNECTOR && isWorkFilesTool(step.tool ?? "");
}

export async function actWorkFiles(opts: {
  uid: string;
  sessionId: string;
  step: WorkFilesStep;
}): Promise<WorkFilesOutcome> {
  const tool = opts.step.tool ?? "";
  const base = {
    label: opts.step.label ?? "",
    connector: WORK_FILES_CONNECTOR,
    tool,
  };

  if (!isWorkFilesTool(tool)) {
    return { ...base, did: "failed", detail: "That file type is not something this can make." };
  }

  if (!storageConfigured) {
    return {
      ...base,
      did: "failed",
      detail: "Artifacts are not available in this environment. The file was not saved.",
    };
  }

  const args = opts.step.arguments ?? {};
  const imagesRemaining = await imagesRemainingFor(opts.uid);
  const cellUrl = documentCellUrl();
  const built = await compileWorkFile({
    tool,
    args,
    imagesRemaining,
    generateImage: generateStill,
    planner: vertexPlanner,
    critic: async (deck, pages) => critiqueDeck(deck, pages, vertexVision),
    callCell: cellUrl
      ? async () => {
          const got = await invokeDocumentCell({ tool, args, imagesRemaining });
          if (!got) throw new Error("document cell unreachable");
          return got;
        }
      : undefined,
  });
  if ("error" in built) {
    return { ...base, did: "failed", detail: built.error };
  }

  if (built.imagesGenerated > 0) {
    await recordUsage(opts.uid, "images", built.imagesGenerated).catch(() => {});
  }

  try {
    const artifact: ArtifactDetail = await createArtifact(opts.uid, {
      kind: "doc",
      title: built.title,
      sessionId: opts.sessionId,
      body: built.body,
      mimeType: built.mimeType,
      prompt: built.prompt,
      provenance: {
        agentId: "work_files",
        cardVersion: "1.0.0",
        model: "",
        sources: [],
      },
    });
    const kind = officeFileLabel(built.mimeType);
    const narration = built.trace?.[0] ? ` ${built.trace[0]}.` : "";
    return {
      ...base,
      did: "done",
      detail: `Saved “${artifact.title}” as a ${kind}.${narration}`,
    };
  } catch (err) {
    console.warn(`[office] persist failed: ${(err as Error).message}`);
    return {
      ...base,
      did: "failed",
      detail: "The file was built but could not be saved.",
    };
  }
}

async function imagesRemainingFor(uid: string): Promise<number | null> {
  try {
    const usage = await readUsage(uid);
    const row = usage.meters.find((meter) => meter.meter === "images");
    if (!row || row.limit === null) return null;
    return row.remaining ?? 0;
  } catch {
    return 0;
  }
}
