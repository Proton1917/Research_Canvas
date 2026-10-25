// 编辑器图片与附件的资产来源。
// 后端资产以 UUID 标识；BlockSuite 的 BlobEngine 在写入时以 SHA-256 内容摘要作为键。
// 写入时把文件导入后端（生成图片文稿与资产），记录摘要键到资产标识的映射，
// 读取时按映射或直接按资产标识获取原始文件。
import type { BlobSource } from '@blocksuite/affine/sync';

import { api } from '../api/client';
import type { ImportResult } from '../api/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AssetBlobSource implements BlobSource {
  readonly name = 'research-canvas-assets';
  readonly readonly = false;
  /** 内容摘要键 → 后端资产标识 */
  readonly keyToAsset = new Map<string, string>();
  private readonly _cache = new Map<string, Blob>();

  constructor(
    private readonly workspaceId: string,
    private readonly onImported: (result: ImportResult) => void
  ) {}

  assetIdFor(key: string): string | null {
    return this.keyToAsset.get(key) ?? (UUID.test(key) ? key : null);
  }

  async get(key: string) {
    const cached = this._cache.get(key);
    if (cached) return cached;
    const assetId = this.assetIdFor(key);
    if (!assetId) return null;
    try {
      const blob = await api.fetchAsset(assetId);
      this._cache.set(key, blob);
      return blob;
    } catch {
      return null;
    }
  }

  async set(key: string, value: Blob) {
    this._cache.set(key, value);
    if (this.assetIdFor(key)) return key;
    const extension = value.type.split('/')[1]?.split('+')[0] || 'bin';
    const file = new File([value], `编辑器插图-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`, { type: value.type });
    const result = await api.importFile(this.workspaceId, file);
    this.keyToAsset.set(key, result.asset.id);
    this.onImported(result);
    return key;
  }

  async delete(key: string) {
    this._cache.delete(key);
  }

  async list() {
    return Array.from(this.keyToAsset.keys());
  }
}
