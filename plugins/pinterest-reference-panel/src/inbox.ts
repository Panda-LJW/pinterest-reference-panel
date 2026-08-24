import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const IMAGE_EXTENSIONS = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"]);
const RECONCILE_INTERVAL_MS = 10_000;
const WATCH_DEBOUNCE_MS = 250;

export type WatcherStatus = "starting" | "watching" | "degraded" | "stopped";

export type InboxAsset = {
  id: string;
  pinId: string;
  boardId: string;
  boardTitle: string;
  title: string;
  extension: string;
  size: number;
  updatedAt: string;
  sourcePath: string;
  sourceRelativePath: string;
  signature: string;
};

export type PublicInboxAsset = Omit<InboxAsset, "sourcePath" | "sourceRelativePath" | "signature">;

export type InboxBoard = {
  id: string;
  title: string;
  pinCount: number;
  coverAssetIds: string[];
};

export type InboxPage = {
  mode: "inbox";
  version: number;
  total: number;
  cursor: string | null;
  nextCursor: string | null;
  assets: PublicInboxAsset[];
  boards: InboxBoard[];
  watcherStatus: WatcherStatus;
  refreshedAt: string;
};

export type InboxPageWithThumbnails = {
  page: InboxPage;
  thumbnails: Record<string, string>;
  thumbnailErrors: Record<string, string>;
};

type InboxServiceOptions = {
  inboxRoot?: string;
  cacheRoot?: string;
  reconcileIntervalMs?: number;
};

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeRelativePath(value: string) {
  return value.split(sep).join("/");
}

function isWithin(root: string, candidate: string) {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== "..");
}

function humanizeSlug(value: string) {
  const decoded = (() => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  })();
  return decoded.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || "Unsorted";
}

export function parseInboxFilename(fileName: string) {
  const extension = extname(fileName).toLowerCase();
  const stem = basename(fileName, extension);
  const match = stem.match(/^([a-zA-Z0-9-]+)__(.+)$/);
  if (!match) return { pinId: stem, title: humanizeSlug(stem), extension };
  return {
    pinId: match[1] ?? stem,
    title: humanizeSlug(match[2] ?? stem),
    extension
  };
}

async function walkImages(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...await walkImages(root, absolutePath));
      continue;
    }
    if (!entry.isFile()) continue;
    const lowerName = entry.name.toLowerCase();
    if (lowerName.endsWith(".crdownload") || lowerName.endsWith(".tmp")) continue;
    if (!IMAGE_EXTENSIONS.has(extname(lowerName))) continue;
    paths.push(absolutePath);
  }
  return paths;
}

async function mapWithConcurrency<T, R>(values: T[], concurrency: number, mapper: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      const value = values[index];
      if (value !== undefined) results[index] = await mapper(value);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

export class InboxService {
  readonly inboxRoot: string;
  readonly cacheRoot: string;
  private readonly reconcileIntervalMs: number;
  private assets = new Map<string, InboxAsset>();
  private version = 0;
  private watcher: FSWatcher | null = null;
  private reconcileTimer: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private scanPromise: Promise<void> | null = null;
  private watcherStatus: WatcherStatus = "stopped";
  private refreshedAt = new Date(0).toISOString();

  constructor(options: InboxServiceOptions = {}) {
    this.inboxRoot = resolve(options.inboxRoot ?? process.env.PINTEREST_INBOX_DIR ?? join(homedir(), "Downloads", "PinterestInbox"));
    this.cacheRoot = resolve(options.cacheRoot ?? join(homedir(), "Library", "Caches", "pinterest-reference-panel", "thumbnails"));
    this.reconcileIntervalMs = options.reconcileIntervalMs ?? RECONCILE_INTERVAL_MS;
  }

  async start() {
    if (this.watcherStatus !== "stopped") return;
    this.watcherStatus = "starting";
    await mkdir(this.inboxRoot, { recursive: true });
    await mkdir(this.cacheRoot, { recursive: true });
    await this.scan();
    this.startWatcher();
    this.reconcileTimer = setInterval(() => {
      void this.scan().catch(() => { this.watcherStatus = "degraded"; });
    }, this.reconcileIntervalMs);
    this.reconcileTimer.unref();
  }

  private startWatcher() {
    try {
      this.watcher = watch(this.inboxRoot, { recursive: true }, () => this.scheduleScan());
      this.watcher.on("error", () => { this.watcherStatus = "degraded"; });
      this.watcherStatus = "watching";
    } catch {
      this.watcherStatus = "degraded";
    }
  }

  private scheduleScan() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.scan().catch(() => { this.watcherStatus = "degraded"; });
    }, WATCH_DEBOUNCE_MS);
    this.debounceTimer.unref();
  }

  async scan() {
    if (this.scanPromise) return this.scanPromise;
    this.scanPromise = this.performScan().finally(() => { this.scanPromise = null; });
    return this.scanPromise;
  }

  private async performScan() {
    await mkdir(this.inboxRoot, { recursive: true });
    const files = await walkImages(this.inboxRoot);
    const records = await mapWithConcurrency(files, 12, async (sourcePath) => {
      const fileStat = await stat(sourcePath);
      const sourceRelativePath = normalizeRelativePath(relative(this.inboxRoot, sourcePath));
      const segments = sourceRelativePath.split("/");
      const boardSlug = segments.length > 1 ? segments[0] ?? "unsorted" : "unsorted";
      const parsed = parseInboxFilename(basename(sourcePath));
      return {
        id: hash(sourceRelativePath).slice(0, 24),
        pinId: parsed.pinId,
        boardId: boardSlug,
        boardTitle: humanizeSlug(boardSlug),
        title: parsed.title,
        extension: parsed.extension,
        size: fileStat.size,
        updatedAt: fileStat.mtime.toISOString(),
        sourcePath,
        sourceRelativePath,
        signature: hash(`${sourceRelativePath}:${fileStat.size}:${fileStat.mtimeMs}`).slice(0, 16)
      } satisfies InboxAsset;
    });
    records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const nextAssets = new Map(records.map((record) => [record.id, record]));
    const previousSignature = [...this.assets.values()].map((item) => item.signature).sort().join(":");
    const nextSignature = records.map((item) => item.signature).sort().join(":");
    if (previousSignature !== nextSignature) this.version += 1;
    this.assets = nextAssets;
    this.refreshedAt = new Date().toISOString();
  }

  getAsset(assetId: string) {
    return this.assets.get(assetId) ?? null;
  }

  async resolveAsset(assetId: string) {
    const asset = this.getAsset(assetId);
    if (!asset) return null;
    try {
      const canonicalRoot = await realpath(this.inboxRoot);
      const canonicalSource = await realpath(asset.sourcePath);
      if (!isWithin(canonicalRoot, canonicalSource) || !(await stat(canonicalSource)).isFile()) return null;
      return { ...asset, sourcePath: canonicalSource };
    } catch {
      return null;
    }
  }

  getSummary() {
    return {
      version: this.version,
      total: this.assets.size,
      watcherStatus: this.watcherStatus,
      refreshedAt: this.refreshedAt
    };
  }

  private buildBoards(records: InboxAsset[]) {
    const boardMap = new Map<string, InboxAsset[]>();
    for (const record of records) {
      const items = boardMap.get(record.boardId) ?? [];
      items.push(record);
      boardMap.set(record.boardId, items);
    }
    return [...boardMap.entries()].map(([id, items]) => ({
      id,
      title: items[0]?.boardTitle ?? humanizeSlug(id),
      pinCount: items.length,
      coverAssetIds: items.slice(0, 3).map((item) => item.id)
    })).sort((left, right) => left.title.localeCompare(right.title));
  }

  async getPage(options: { cursor?: string; limit?: number; forceRescan?: boolean } = {}): Promise<InboxPageWithThumbnails> {
    if (options.forceRescan) await this.scan();
    const records = [...this.assets.values()];
    const offset = Math.max(0, Number.parseInt(options.cursor ?? "0", 10) || 0);
    const limit = Math.max(1, Math.min(options.limit ?? 30, 30));
    const visible = records.slice(offset, offset + limit);
    const thumbnailEntries = await mapWithConcurrency(visible, 4, async (asset) => {
      try {
        return [asset.id, await this.getThumbnailDataUrl(asset), null] as const;
      } catch (error) {
        return [asset.id, null, error instanceof Error ? error.message : String(error)] as const;
      }
    });
    const thumbnails: Record<string, string> = {};
    const thumbnailErrors: Record<string, string> = {};
    for (const [assetId, dataUrl, error] of thumbnailEntries) {
      if (dataUrl) thumbnails[assetId] = dataUrl;
      if (error) thumbnailErrors[assetId] = error;
    }
    return {
      page: {
        mode: "inbox",
        version: this.version,
        total: records.length,
        cursor: offset === 0 ? null : String(offset),
        nextCursor: offset + visible.length < records.length ? String(offset + visible.length) : null,
        assets: visible.map(({ sourcePath: _sourcePath, sourceRelativePath: _relativePath, signature: _signature, ...asset }) => asset),
        boards: this.buildBoards(records),
        watcherStatus: this.watcherStatus,
        refreshedAt: this.refreshedAt
      },
      thumbnails,
      thumbnailErrors
    };
  }

  private async getThumbnailDataUrl(asset: InboxAsset) {
    if (process.platform !== "darwin" || !existsSync("/usr/bin/sips")) throw new Error("macOS sips is unavailable");
    const cachePath = join(this.cacheRoot, `${asset.id}-${asset.signature}.jpg`);
    if (!existsSync(cachePath)) {
      const temporaryPath = `${cachePath}.${process.pid}.${Date.now()}.tmp.jpg`;
      try {
        await execFileAsync("/usr/bin/sips", ["-Z", "480", "-s", "format", "jpeg", asset.sourcePath, "--out", temporaryPath], { timeout: 15_000 });
        await rename(temporaryPath, cachePath);
      } catch (error) {
        await rm(temporaryPath, { force: true });
        throw error;
      }
    }
    return `data:image/jpeg;base64,${(await readFile(cachePath)).toString("base64")}`;
  }

  async close() {
    this.watcher?.close();
    this.watcher = null;
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.reconcileTimer = null;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.watcherStatus = "stopped";
  }
}
