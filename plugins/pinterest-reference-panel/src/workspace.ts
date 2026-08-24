import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, copyFile, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import type { InboxAsset } from "./inbox.js";

export type WorkspaceState = { available: boolean; name: string | null; token: string | null; reason: string | null };

function isWithin(root: string, candidate: string) {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== "..");
}

function safeSegment(value: string) {
  const cleaned = value.normalize("NFKC").replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "-").replace(/\.{2,}/g, ".").replace(/\s+/g, " ").trim().replace(/^\.+|\.+$/g, "").slice(0, 96);
  return cleaned || "reference";
}

async function fileHash(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export class WorkspaceRegistry {
  private readonly roots = new Map<string, string>();

  async register(candidate: string | null): Promise<WorkspaceState> {
    if (!candidate) return { available: false, name: null, token: null, reason: "Codex 未提供当前工作区路径" };
    try {
      const canonicalPath = await realpath(resolve(candidate));
      if (!(await stat(canonicalPath)).isDirectory()) throw new Error("工作区不是目录");
      await access(canonicalPath, constants.R_OK | constants.W_OK);
      const token = randomBytes(24).toString("base64url");
      this.roots.set(token, canonicalPath);
      return { available: true, name: basename(canonicalPath), token, reason: null };
    } catch (error) {
      return { available: false, name: null, token: null, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  async importAsset(asset: InboxAsset, token: string) {
    const workspaceRoot = this.roots.get(token);
    if (!workspaceRoot) throw new Error("工作区令牌无效或已过期");
    const canonicalRoot = await realpath(workspaceRoot);
    const destinationDirectory = join(canonicalRoot, "references", "pinterest", safeSegment(asset.boardId));
    await mkdir(destinationDirectory, { recursive: true });
    const canonicalDestinationDirectory = await realpath(destinationDirectory);
    if (!isWithin(canonicalRoot, canonicalDestinationDirectory)) throw new Error("工作区子目录指向了根目录之外");

    const extension = extname(asset.sourcePath).toLowerCase();
    const stem = safeSegment(basename(asset.sourcePath, extension));
    const sourceDigest = await fileHash(asset.sourcePath);
    let destinationPath = join(canonicalDestinationDirectory, `${stem}${extension}`);
    try {
      if (await fileHash(destinationPath) === sourceDigest) return this.result(canonicalRoot, destinationPath, true);
      destinationPath = join(canonicalDestinationDirectory, `${stem}-${sourceDigest.slice(0, 8)}${extension}`);
      try {
        if (await fileHash(destinationPath) === sourceDigest) return this.result(canonicalRoot, destinationPath, true);
      } catch {
        // The suffixed destination does not exist yet.
      }
    } catch {
      // The primary destination does not exist yet.
    }
    if (!isWithin(canonicalRoot, await realpath(dirname(destinationPath)))) throw new Error("目标路径越过了工作区边界");
    await copyFile(asset.sourcePath, destinationPath, constants.COPYFILE_EXCL);
    return this.result(canonicalRoot, destinationPath, false);
  }

  private result(workspaceRoot: string, destinationPath: string, reused: boolean) {
    return { relativePath: relative(workspaceRoot, destinationPath).split(sep).join("/"), fileName: basename(destinationPath), reused };
  }
}
