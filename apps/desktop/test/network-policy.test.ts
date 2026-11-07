import { describe, expect, it } from 'vitest';
import { isAllowedRequest, isAppUrl } from '../src/shared/network-policy';

const DEV = 'http://localhost:5173';

describe('isAllowedRequest', () => {
  it.each([
    'app://framewright/index.html',
    'app://framewright/assets/index-abc.js',
    'userlib://materials/oak/color.jpg',
    'data:image/png;base64,AAAA',
    'blob:app://framewright/1234',
    'devtools://devtools/bundled/inspector.html',
  ])('allows local URL %s', (url) => {
    expect(isAllowedRequest(url, null)).toBe(true);
  });

  it.each([
    'https://example.com/',
    'http://localhost:5173/',
    'ws://localhost:5173/',
    'file:///C:/Windows/win.ini',
    'ftp://example.com/x',
    'app://other-host/index.html',
    'not a url',
  ])('blocks %s in production', (url) => {
    expect(isAllowedRequest(url, null)).toBe(false);
  });

  it('allows only the dev server origin and its HMR socket in dev', () => {
    expect(isAllowedRequest('http://localhost:5173/src/main.tsx', DEV)).toBe(true);
    expect(isAllowedRequest('ws://localhost:5173/', DEV)).toBe(true);
    expect(isAllowedRequest('http://localhost:5174/', DEV)).toBe(false);
    expect(isAllowedRequest('https://localhost:5173/', DEV)).toBe(false);
    expect(isAllowedRequest('https://example.com/', DEV)).toBe(false);
  });

  it('allows a Framewright release download only while update checks are on', () => {
    const latest = 'https://api.github.com/repos/brandondonofrio1998-code/framewright/releases/latest';
    const installer = 'https://github.com/brandondonofrio1998-code/framewright/releases/download/v0.1.0/Framewright-0.1.0-setup.exe';
    const asset = 'https://release-assets.githubusercontent.com/github-production-release-asset/1';
    expect(isAllowedRequest(latest, null)).toBe(false);
    expect(isAllowedRequest(installer, null)).toBe(false);
    expect(isAllowedRequest(latest, null, true)).toBe(true);
    expect(isAllowedRequest(installer, null, true)).toBe(true);
    expect(isAllowedRequest(asset, null, true)).toBe(true);
    expect(isAllowedRequest('https://api.github.com/repos/other/project/releases/latest', null, true)).toBe(false);
    expect(isAllowedRequest('https://example.com/', null, true)).toBe(false);
  });
});

describe('isAppUrl', () => {
  it('recognises app pages even though URL.origin is "null" for custom schemes', () => {
    expect(new URL('app://framewright/index.html').origin).toBe('null');
    expect(isAppUrl('app://framewright/index.html', null)).toBe(true);
  });

  it('rejects other hosts, schemes and the dev server in production', () => {
    expect(isAppUrl('app://evil/index.html', null)).toBe(false);
    expect(isAppUrl('https://example.com/', null)).toBe(false);
    expect(isAppUrl('http://localhost:5173/', null)).toBe(false);
    expect(isAppUrl('not a url', null)).toBe(false);
  });

  it('accepts the dev server only when one is configured', () => {
    expect(isAppUrl('http://localhost:5173/index.html', DEV)).toBe(true);
    expect(isAppUrl('http://localhost:5174/index.html', DEV)).toBe(false);
  });
});
