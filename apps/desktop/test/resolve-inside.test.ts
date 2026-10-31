import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mimeTypeFor, resolveInside } from '../src/main/resolve-inside';

const root = resolve('/srv/app/renderer');

describe('resolveInside', () => {
  it('resolves files inside the root', () => {
    expect(resolveInside(root, '/index.html')).toBe(join(root, 'index.html'));
    expect(resolveInside(root, '/assets/a%20b.js')).toBe(join(root, 'assets', 'a b.js'));
  });

  it.each(['/../main/index.js', '/%2e%2e/main/index.js', '/..%2fmain%2findex.js', '/assets/../../x', '/..%5cmain%5cindex.js'])(
    'rejects traversal %s',
    (pathname) => {
      expect(resolveInside(root, pathname)).toBeNull();
    },
  );

  it('rejects the root itself, NUL bytes and malformed escapes', () => {
    expect(resolveInside(root, '/')).toBeNull();
    expect(resolveInside(root, '/index.html%00.js')).toBeNull();
    expect(resolveInside(root, '/%E0%A4%A')).toBeNull();
  });
});

describe('mimeTypeFor', () => {
  it('maps known extensions and falls back to octet-stream', () => {
    expect(mimeTypeFor('a/index.HTML')).toBe('text/html; charset=utf-8');
    expect(mimeTypeFor('x.wasm')).toBe('application/wasm');
    expect(mimeTypeFor('x.unknown')).toBe('application/octet-stream');
  });
});
