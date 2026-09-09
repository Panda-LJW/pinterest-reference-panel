import { randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import { InboxService, type InboxAsset, type PublicInboxAsset } from "./inbox.js";

export const MAX_REFERENCES = 10;
export const REFERENCE_SESSION_PATTERN = /^[a-f0-9]{32}$/;

export class ReferenceError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

type Entry = { asset: PublicInboxAsset; fingerprint: string };
type Session = { id: string; revision: number; entries: Entry[] };

function publicAsset(asset: InboxAsset): PublicInboxAsset {
  const { sourcePath: _path, sourceRelativePath: _relative, signature: _signature, ...value } = asset;
  return value;
}

async function fingerprint(path: string, indexed?: InboxAsset) {
  const value = await stat(path);
  if (indexed && (value.size !== indexed.size || value.mtime.toISOString() !== indexed.updatedAt)) {
    throw new ReferenceError(409, "图片在索引后发生变化，请刷新素材库后重新选择");
  }
  return `${value.dev}:${value.ino}:${value.size}:${value.mtimeMs}:${value.ctimeMs}`;
}

// Explicit capabilities, not a process-wide "last selected" list: callers must
// carry the session returned when their own task opened the panel.
export class ReferenceSessions {
  private sessions = new Map<string, Session>();
  constructor(private readonly inbox: InboxService) {}

  create() {
    if (this.sessions.size >= 64) throw new ReferenceError(409, "参考会话已达上限，请重启插件后重新选择图片");
    const session: Session = { id: randomBytes(16).toString("hex"), revision: 0, entries: [] };
    this.sessions.set(session.id, session);
    return session.id;
  }

  require(id: string) {
    const session = REFERENCE_SESSION_PATTERN.test(id) ? this.sessions.get(id) : undefined;
    if (!session) throw new ReferenceError(410, "参考会话已失效，请让 Codex 重新打开参考篮");
    return session;
  }

  async describe(id: string) {
    const session = this.require(id);
    const revision = session.revision;
    const entries = await Promise.all(session.entries.map(async (entry, index) => {
      const asset = await this.inbox.resolveAsset(entry.asset.id);
      const current = asset ? await fingerprint(asset.sourcePath).catch(() => null) : null;
      const status = current === null ? "missing" : current !== entry.fingerprint ? "changed" : "ready";
      return { ...entry.asset, number: index + 1, status };
    }));
    return { referenceSessionId: id, revision, limit: MAX_REFERENCES, entries };
  }

  async replace(id: string, assetIds: string[], expectedRevision: number) {
    const session = this.require(id);
    if (session.revision !== expectedRevision) throw new ReferenceError(409, "参考篮已在其他页面更新，请查看最新选择后重试");
    if (assetIds.length > MAX_REFERENCES) throw new ReferenceError(400, `一次最多选择 ${MAX_REFERENCES} 张参考图`);
    if (new Set(assetIds).size !== assetIds.length || assetIds.some(id => !/^[a-f0-9]{24}$/.test(id))) {
      throw new ReferenceError(400, "参考图列表包含重复项或无效素材 ID");
    }
    const entries = await Promise.all(assetIds.map(async assetId => {
      const previous = session.entries.find(entry => entry.asset.id === assetId);
      // Reordering must not silently approve replacement image bytes.
      if (previous) return previous;
      const asset = await this.inbox.resolveAsset(assetId);
      if (!asset) throw new ReferenceError(404, "图片已不在素材库中，请刷新后重试");
      const fileFingerprint = await fingerprint(asset.sourcePath, asset).catch(error => {
        if (error instanceof ReferenceError) throw error;
        return null;
      });
      if (!fileFingerprint) throw new ReferenceError(404, "图片暂时不可读，请刷新后重试");
      return { asset: publicAsset(asset), fingerprint: fileFingerprint };
    }));
    if (session.revision !== expectedRevision) throw new ReferenceError(409, "参考篮已在其他页面更新，请查看最新选择后重试");
    if (session.entries.map(entry => entry.asset.id).join() !== assetIds.join()) {
      session.entries = entries;
      session.revision += 1;
    }
    return this.describe(id);
  }

  async resolve(id: string, expectedRevision?: number) {
    const session = this.require(id);
    const revision = session.revision;
    if (expectedRevision !== undefined && revision !== expectedRevision) {
      throw new ReferenceError(409, "参考图选择已经变化，请重新读取参考篮");
    }
    if (!session.entries.length) throw new ReferenceError(409, "参考篮还是空的，请先在面板中选择图片");
    const files = await Promise.all(session.entries.map(async (entry, index) => {
      const asset = await this.inbox.resolveAsset(entry.asset.id);
      const current = asset ? await fingerprint(asset.sourcePath).catch(() => null) : null;
      if (!asset || current !== entry.fingerprint) {
        throw new ReferenceError(409, `参考图 ${index + 1} 已变化或不可用，请移除后重新选择`);
      }
      return { number: index + 1, assetId: asset.id, title: asset.title, boardTitle: asset.boardTitle, path: asset.sourcePath };
    }));
    if (session.revision !== revision) throw new ReferenceError(409, "读取期间参考图选择发生变化，请重试");
    return { referenceSessionId: id, revision, files };
  }
}
