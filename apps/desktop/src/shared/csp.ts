const directives: Record<string, string[]> = {
  'default-src': ["'none'"],
  'script-src': ["'self'", "'wasm-unsafe-eval'"],
  'worker-src': ["'self'", 'blob:'],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'data:', 'blob:', 'userlib:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'", 'userlib:'],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'frame-ancestors': ["'none'"],
};

const serialize = (entries: [string, string[]][]) => entries.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');

/** Sent as a response header by the app:// protocol handler. */
export const PRODUCTION_CSP = serialize(Object.entries(directives));

/** Chromium ignores (and warns about) `frame-ancestors` inside a <meta> CSP. */
export const META_CSP = serialize(Object.entries(directives).filter(([name]) => name !== 'frame-ancestors'));

/**
 * Dev only: the Vite dev server needs inline scripts for React Fast Refresh and a
 * websocket back to itself for HMR. Never used when loading from app://.
 */
export function devCsp(devServerOrigin: string): string {
  const wsOrigin = devServerOrigin.replace(/^http/, 'ws');
  return PRODUCTION_CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
    .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
    .replace("connect-src 'self'", `connect-src 'self' ${wsOrigin}`);
}
