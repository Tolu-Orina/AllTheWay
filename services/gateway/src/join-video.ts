import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Concatenate MP4 clips without re-encoding when the codecs match.
 *
 * Re-encoding would destroy any content credentials the source clips carried.
 * Copy-concat still produces a *new* file, so we do not claim the joined
 * object inherits C2PA. Each source shot remains the credentialed original
 * if it is kept; the join is an assembly.
 */

const execFileAsync = promisify(execFile);

export function resolveFfmpeg(): string | null {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }
  if (existsSync("/repo/ffmpeg")) return "/repo/ffmpeg";
  return "ffmpeg";
}

function concatListLine(filePath: string): string {
  const escaped = filePath.replace(/\\/g, "/").replace(/'/g, "'\\''");
  return `file '${escaped}'`;
}

export async function concatMp4(clips: Buffer[]): Promise<Buffer> {
  if (clips.length === 0) throw new Error("Nothing to join.");
  if (clips.length === 1) return clips[0]!;

  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) throw new Error("ffmpeg is not available, so shots cannot be joined.");

  const dir = await mkdtemp(join(tmpdir(), "atw-join-"));
  try {
    const files: string[] = [];
    for (let i = 0; i < clips.length; i++) {
      const path = join(dir, `s${i}.mp4`);
      await writeFile(path, clips[i]!);
      files.push(path);
    }
    const listPath = join(dir, "list.txt");
    const out = join(dir, "out.mp4");
    await writeFile(listPath, files.map(concatListLine).join("\n"));

    try {
      await execFileAsync(ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", out], {
        timeout: 60_000,
      });
    } catch {
      await execFileAsync(
        ffmpeg,
        ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", out],
        { timeout: 120_000 },
      );
    }

    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
