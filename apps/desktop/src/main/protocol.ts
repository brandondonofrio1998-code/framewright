import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { protocol } from 'electron';
import { PRODUCTION_CSP } from '../shared/csp';
import { APP_HOST, APP_SCHEME } from '../shared/network-policy';
import { mimeTypeFor, resolveInside } from './resolve-inside';

/** Must run before `app` is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

const notFound = () => new Response('Not found', { status: 404 });

export function handleAppProtocol(): void {
  const rendererRoot = join(__dirname, '../renderer');

  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST) return notFound();

    const filePath = resolveInside(rendererRoot, url.pathname === '/' ? '/index.html' : url.pathname);
    if (filePath === null) return notFound();

    let body: Buffer;
    try {
      body = await readFile(filePath);
    } catch {
      return notFound();
    }
    return new Response(new Uint8Array(body), {
      headers: {
        'Content-Type': mimeTypeFor(filePath),
        'Content-Security-Policy': PRODUCTION_CSP,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
}
