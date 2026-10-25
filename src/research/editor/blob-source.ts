// 编辑器图片与附件的资产来源。
// 写入成功后保存编辑器对象标识到后端资产标识的映射。
import type { BlobSource } from '@editor/storage';

import { api, ApiError } from '../api/client';
import type { ImportResult } from '../api/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AssetBlobSource implements BlobSource {
  readonly name = 'research-canvas-assets';
  readonly readonly = false;
  /** 编辑器对象标识到后端资产标识的映射。 */
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
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  async set(key: string, value: Blob) {
    if (this.keyToAsset.has(key) && this._cache.get(key) === value) return key;
    const extension = value.type.split('/')[1]?.split('+')[0] || 'bin';
    const file = new File([value], `编辑器插图-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`, { type: value.type });
    const result = await api.importFile(this.workspaceId, file);
    this.keyToAsset.set(key, result.asset.id);
    this._cache.set(key, value);
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
