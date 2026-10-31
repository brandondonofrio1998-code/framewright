import { describe, expect, it } from 'vitest';
import { findForbiddenUrls, scanText } from './check-offline.mjs';

describe('offline URL scan', () => {
  it('finds no network URLs in runtime sources', () => {
    expect(findForbiddenUrls({ includeBuild: false })).toEqual([]);
  });

  it('flags http, https and websocket URLs', () => {
    const text = ['fetch("https://cdn.example.com/lib.js")', "const u = 'http://localhost:5173';", 'new WebSocket(`wss://x.test/ws`)'].join('\n');
    expect(scanText(text, 'source').map((hit) => hit.url)).toEqual([
      'https://cdn.example.com/lib.js',
      'http://localhost:5173',
      'wss://x.test/ws',
    ]);
  });

  it('allows XML namespace identifiers', () => {
    expect(scanText('createElementNS("http://www.w3.org/2000/svg", "path")', 'source')).toEqual([]);
  });

  it('does not let a namespace prefix hide a real URL', () => {
    expect(scanText('"http://www.w3.org/2000/svg/../evil.js"', 'source')).toHaveLength(1);
  });
});
