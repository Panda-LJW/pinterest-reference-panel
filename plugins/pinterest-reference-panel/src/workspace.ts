import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access, copyFile, lstat, mkdir, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { InboxAsset } from "./inbox.js";

export type WorkspaceState = { available: boolean; name: string | null; token: string | null; reason: string | null };
type OptimizationState = "source-lightweight" | "generated" | "fallback";
type PreparedReference = { path: string; extension: string; optimization: OptimizationState; cacheReused: boolean; reason: string | null };
type WorkspaceRegistryOptions = { derivativeCacheRoot?: string; imageProcessorPath?: string; platform?: NodeJS.Platform };

const execFileAsync = promisify(execFile);
const REFERENCE_MAX_EDGE = 2048;
const REFERENCE_JPEG_QUALITY = 80;

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

function parseSipsProperties(stdout: string) {
  const property = (name: string) => stdout.match(new RegExp(`^\\s*${name}:\\s*(.+)\\s*$`, "mi"))?.[1]?.trim() ?? null;
  const width = Number.parseInt(property("pixelWidth") ?? "", 10);
  const height = Number.parseInt(property("pixelHeight") ?? "", 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw new Error("无法读取图片尺寸");
  return { width, height, hasAlpha: /^(yes|true)$/i.test(property("hasAlpha") ?? "") };
}

export class WorkspaceRegistry {
  private readonly roots = new Map<string, string>();
  private readonly derivativeCacheRoot: string;
  private readonly imageProcessorPath: string;
  private readonly platform: NodeJS.Platform;

  constructor(options: WorkspaceRegistryOptions = {}) {
    this.derivativeCacheRoot = resolve(options.derivativeCacheRoot ?? join(homedir(), "Library", "Caches", "pinterest-reference-panel", "references"));
    this.imageProcessorPath = options.imageProcessorPath ?? "/usr/bin/sips";
    this.platform = options.platform ?? process.platform;
  }

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

    const prepared = await this.prepareReference(asset);
    const extension = prepared.extension;
    const stem = safeSegment(basename(asset.sourcePath, extname(asset.sourcePath)));
    const sourceDigest = await fileHash(prepared.path);
    let destinationPath = join(canonicalDestinationDirectory, `${stem}${extension}`);
    try {
      if (await fileHash(destinationPath) === sourceDigest) return this.result(canonicalRoot, destinationPath, true, prepared);
      destinationPath = join(canonicalDestinationDirectory, `${stem}-${sourceDigest.slice(0, 8)}${extension}`);
      try {
        if (await fileHash(destinationPath) === sourceDigest) return this.result(canonicalRoot, destinationPath, true, prepared);
      } catch {
        // The suffixed destination does not exist yet.
      }
    } catch {
      // The primary destination does not exist yet.
    }
    if (!isWithin(canonicalRoot, await realpath(dirname(destinationPath)))) throw new Error("目标路径越过了工作区边界");
    await copyFile(prepared.path, destinationPath, constants.COPYFILE_EXCL);
    return this.result(canonicalRoot, destinationPath, false, prepared);
  }

  private async prepareReference(asset: InboxAsset): Promise<PreparedReference> {
    const sourceExtension = extname(asset.sourcePath).toLowerCase() === ".jpeg" ? ".jpg" : extname(asset.sourcePath).toLowerCase();
    const fallback = (reason: string): PreparedReference => ({
      path: asset.sourcePath,
      extension: sourceExtension,
      optimization: "fallback",
      cacheReused: false,
      reason
    });
    if (sourceExtension === ".webp") {
      return { path: asset.sourcePath, extension: sourceExtension, optimization: "source-lightweight", cacheReused: false, reason: null };
    }
    if (this.platform !== "darwin" || !existsSync(this.imageProcessorPath)) return fallback("macOS sips 不可用，已保留原文件");

    let temporaryPath: string | null = null;
    try {
      const inspected = await execFileAsync(this.imageProcessorPath, ["-g", "pixelWidth", "-g", "pixelHeight", "-g", "hasAlpha", asset.sourcePath], { timeout: 15_000 });
      const properties = parseSipsProperties(inspected.stdout);
      const sourceStat = await stat(asset.sourcePath);
      const withinReferenceSize = Math.max(properties.width, properties.height) <= REFERENCE_MAX_EDGE;
      const reusableFormat = properties.hasAlpha ? sourceExtension === ".png" : sourceExtension === ".jpg";
      if (withinReferenceSize && reusableFormat) {
        return { path: asset.sourcePath, extension: sourceExtension, optimization: "source-lightweight", cacheReused: false, reason: null };
      }

      const targetExtension = properties.hasAlpha ? ".png" : ".jpg";
      const recipe = properties.hasAlpha ? `png-${REFERENCE_MAX_EDGE}` : `jpeg-${REFERENCE_MAX_EDGE}-q${REFERENCE_JPEG_QUALITY}`;
      const digest = await fileHash(asset.sourcePath);
      await mkdir(this.derivativeCacheRoot, { recursive: true });
      const canonicalCacheRoot = await realpath(this.derivativeCacheRoot);
      const cachePath = join(canonicalCacheRoot, `${digest.slice(0, 32)}-${recipe}${targetExtension}`);
      if (existsSync(cachePath)) {
        const cachedStat = await lstat(cachePath);
        if (!cachedStat.isFile() || cachedStat.isSymbolicLink() || cachedStat.size < 1) throw new Error("引用缓存不是安全的普通文件");
        if (cachedStat.size >= sourceStat.size) {
          return { path: asset.sourcePath, extension: sourceExtension, optimization: "source-lightweight", cacheReused: false, reason: null };
        }
        return { path: cachePath, extension: targetExtension, optimization: "generated", cacheReused: true, reason: null };
      }

      temporaryPath = `${cachePath}.${process.pid}.${Date.now()}.tmp${targetExtension}`;
      const formatArguments = properties.hasAlpha
        ? ["-s", "format", "png"]
        : ["-s", "format", "jpeg", "-s", "formatOptions", String(REFERENCE_JPEG_QUALITY)];
      await execFileAsync(this.imageProcessorPath, ["-Z", String(REFERENCE_MAX_EDGE), ...formatArguments, asset.sourcePath, "--out", temporaryPath], { timeout: 60_000 });
      const generatedStat = await stat(temporaryPath);
      if (generatedStat.size < 1) throw new Error("生成的引用图片为空");
      if (generatedStat.size >= sourceStat.size) {
        await rm(temporaryPath, { force: true });
        temporaryPath = null;
        return { path: asset.sourcePath, extension: sourceExtension, optimization: "source-lightweight", cacheReused: false, reason: null };
      }
      await rename(temporaryPath, cachePath);
      temporaryPath = null;
      return { path: cachePath, extension: targetExtension, optimization: "generated", cacheReused: false, reason: null };
    } catch (error) {
      return fallback(error instanceof Error ? `引用版生成失败：${error.message}` : "引用版生成失败");
    } finally {
      if (temporaryPath) await rm(temporaryPath, { force: true });
    }
  }

  private result(workspaceRoot: string, destinationPath: string, reused: boolean, prepared: PreparedReference) {
    return {
      relativePath: relative(workspaceRoot, destinationPath).split(sep).join("/"),
      fileName: basename(destinationPath),
      reused,
      optimization: prepared.optimization,
      cacheReused: prepared.cacheReused,
      optimizationReason: prepared.reason
    };
  }
}
