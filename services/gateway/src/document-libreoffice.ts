import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PDFDocument } from "pdf-lib";

/**
 * Real slide screenshots for visual QA. The critic looks at these, not at
 * a compositor sketch of the IR.
 *
 * soffice can only emit the first page as PNG from a multi-page file, so:
 * PPTX → PDF → one one-page PDF per slide → PNG.
 */

const SOFFICE_TIMEOUT_MS = 60_000;
const RENDER_TIMEOUT_MS = 90_000;

const CANDIDATES = [
  process.env.LIBREOFFICE_BIN,
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
  "/usr/bin/soffice",
  "/usr/bin/libreoffice",
  "/usr/lib/libreoffice/program/soffice",
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
].filter((p): p is string => Boolean(p));

export type RenderPagesFn = (pptx: Buffer) => Promise<Buffer[]>;

export function resolveSoffice(): string | null {
  for (const candidate of CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function isLibreOfficeAvailable(): boolean {
  return resolveSoffice() !== null;
}

export async function renderPptxPages(pptx: Buffer): Promise<Buffer[]> {
  const soffice = resolveSoffice();
  if (!soffice) {
    throw new Error("LibreOffice is not installed (set LIBREOFFICE_BIN)");
  }
  const root = await mkdtemp(path.join(tmpdir(), "atw-lo-"));
  const profile = path.join(root, "profile");
  const pagesDir = path.join(root, "pages");
  const pptxPath = path.join(root, "deck.pptx");
  try {
    await writeFile(pptxPath, pptx);
    await runSoffice(
      soffice,
      profile,
      ["--convert-to", "pdf", "--outdir", root, pptxPath],
      SOFFICE_TIMEOUT_MS,
    );
    const pdfPath = path.join(root, "deck.pdf");
    if (!existsSync(pdfPath)) {
      throw new Error("LibreOffice did not write a PDF");
    }
    const src = await PDFDocument.load(await readFile(pdfPath));
    const count = src.getPageCount();
    if (count < 1) throw new Error("LibreOffice PDF has no pages");
    await mkdir(pagesDir, { recursive: true });
    const pagePdfs: string[] = [];
    for (let i = 0; i < count; i++) {
      const one = await PDFDocument.create();
      const [copied] = await one.copyPages(src, [i]);
      one.addPage(copied);
      const out = path.join(pagesDir, `page-${String(i + 1).padStart(2, "0")}.pdf`);
      await writeFile(out, await one.save());
      pagePdfs.push(out);
    }
    await runSoffice(
      soffice,
      profile,
      ["--convert-to", "png", "--outdir", pagesDir, ...pagePdfs],
      SOFFICE_TIMEOUT_MS,
    );
    const pngs = (await readdir(pagesDir))
      .filter((name) => name.toLowerCase().endsWith(".png"))
      .sort();
    if (pngs.length !== count) {
      throw new Error(`LibreOffice wrote ${pngs.length} PNGs for ${count} slides`);
    }
    const pages: Buffer[] = [];
    for (const name of pngs) {
      const bytes = await readFile(path.join(pagesDir, name));
      if (bytes.length < 32 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
        throw new Error(`LibreOffice wrote a non-PNG for ${name}`);
      }
      pages.push(bytes);
    }
    return pages;
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

export async function renderPptxPagesOrThrow(pptx: Buffer): Promise<Buffer[]> {
  return withTimeout(renderPptxPages(pptx), RENDER_TIMEOUT_MS);
}

function runSoffice(bin: string, profile: string, args: string[], timeoutMs: number): Promise<void> {
  const profileUrl = pathToFileURL(profile).href;
  return new Promise((resolve, reject) => {
    const child = spawn(
      bin,
      [
        "--headless",
        "--norestore",
        "--nolockcheck",
        "--nologo",
        "--nofirststartwizard",
        `-env:UserInstallation=${profileUrl}`,
        ...args,
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let err = "";
    child.stderr?.on("data", (chunk) => {
      err += String(chunk);
    });
    const timer = setTimeout(() => {
      kill(child.pid);
      reject(new Error("LibreOffice timed out"));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `LibreOffice exited ${code}`));
    });
  });
}

function kill(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* already gone */
  }
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("LibreOffice timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
