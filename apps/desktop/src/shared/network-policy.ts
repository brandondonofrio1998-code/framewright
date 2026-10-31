export const APP_SCHEME = 'app';
export const APP_HOST = 'framewright';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`;

const ALWAYS_ALLOWED_SCHEMES = new Set(['app:', 'userlib:', 'devtools:', 'data:', 'blob:']);

/**
 * The only network policy in the app: local schemes are allowed, everything else is
 * cancelled. `devServerOrigin` is non-null only for unpackaged `electron-vite dev` runs.
 */
export function isAllowedRequest(rawUrl: string, devServerOrigin: string | null): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol === 'app:') return url.host === APP_HOST;
  if (ALWAYS_ALLOWED_SCHEMES.has(url.protocol)) return true;
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
