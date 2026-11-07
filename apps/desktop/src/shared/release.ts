export interface ReleaseAsset {
  name: string;
  url: string;
}

export interface ReleaseInfo {
  version: string;
  assets: ReleaseAsset[];
}

/** `v1.2.3` and `1.2.3` compare as numbers. A missing piece is zero. */
export function versionNewer(latest: string, current: string): boolean {
  const parse = (value: string) =>
    value
      .trim()
      .replace(/^v/i, '')
      .split('.')
      .map((part) => {
        const n = Number.parseInt(part, 10);
        return Number.isFinite(n) ? n : 0;
      });
  const a = parse(latest);
  const b = parse(current);
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

export function parseRelease(body: unknown): ReleaseInfo | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as { tag_name?: unknown; assets?: unknown };
  if (typeof record.tag_name !== 'string') return null;
  const assets: ReleaseAsset[] = [];
  if (Array.isArray(record.assets)) {
    for (const asset of record.assets) {
      if (typeof asset !== 'object' || asset === null) continue;
      const item = asset as { name?: unknown; browser_download_url?: unknown };
      if (typeof item.name === 'string' && typeof item.browser_download_url === 'string') assets.push({ name: item.name, url: item.browser_download_url });
    }
  }
  return { version: record.tag_name.replace(/^v/i, ''), assets };
}

/** The installer for this computer. Portable builds and block maps are left out. */
export function assetForPlatform(assets: readonly ReleaseAsset[], platform: string): ReleaseAsset | null {
  if (platform === 'win32') return assets.find((asset) => asset.name.endsWith('-setup.exe')) ?? null;
  if (platform === 'darwin') return assets.find((asset) => asset.name.endsWith('.dmg')) ?? null;
  return null;
}
