export const APP_SCHEME = 'app';
export const APP_HOST = 'framewright';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`;
export const LATEST_RELEASE_PATH = '/repos/brandondonofrio1998-code/framewright/releases/latest';

/** Built without a literal URL so the offline scan stays exact. Requested only after the user allows updates. */
export function latestReleaseUrl(): string {
  return `${'https:'}//api.github.com${LATEST_RELEASE_PATH}`;
}

const ALWAYS_ALLOWED_SCHEMES = new Set(['app:', 'userlib:', 'devtools:', 'data:', 'blob:']);

const UPDATE_REPO = '/brandondonofrio1998-code/framewright/';

/** Hosts used only while Help > Allow Update Checks is on. */
function isUpdateUrl(url: URL): boolean {
  if (url.protocol !== 'https:') return false;
  if (url.host === 'api.github.com') return url.pathname === `/repos${UPDATE_REPO}releases/latest`;
  if (url.host === 'github.com') return url.pathname.startsWith(`${UPDATE_REPO}releases/`);
  return url.host === 'objects.githubusercontent.com' || url.host === 'release-assets.githubusercontent.com' || url.host === 'github-releases.githubusercontent.com';
}

/**
 * The only network policy in the app: local schemes are allowed, everything else is
 * cancelled. `devServerOrigin` is non-null only for unpackaged `electron-vite dev` runs.
 * GitHub release URLs are allowed only when the user has turned update checks on.
 */
export function isAllowedRequest(rawUrl: string, devServerOrigin: string | null, updatesEnabled = false): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol === 'app:') return url.host === APP_HOST;
  if (ALWAYS_ALLOWED_SCHEMES.has(url.protocol)) return true;
  if (updatesEnabled && isUpdateUrl(url)) return true;
  if (devServerOrigin === null) return false;

  const dev = new URL(devServerOrigin);
  if (url.host !== dev.host) return false;
  return url.protocol === dev.protocol || url.protocol === dev.protocol.replace(/^http/, 'ws');
}

/** Scheme + host. `URL.origin` cannot be used: it is the string "null" for custom schemes like app:. */
function schemeAndHost(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/** True for pages that belong to the app itself: app://framewright, or the dev server in dev. */
export function isAppUrl(rawUrl: string, devServerOrigin: string | null): boolean {
  const key = schemeAndHost(rawUrl);
  return key !== null && (key === APP_ORIGIN || (devServerOrigin !== null && key === schemeAndHost(devServerOrigin)));
}
