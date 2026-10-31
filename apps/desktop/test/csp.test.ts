import { describe, expect, it } from 'vitest';
import { devCsp, META_CSP, PRODUCTION_CSP } from '../src/shared/csp';

const directive = (csp: string, name: string) =>
  csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));

describe('content security policy', () => {
  it('denies by default and allows no remote or inline sources in production', () => {
    expect(directive(PRODUCTION_CSP, 'default-src')).toBe("default-src 'none'");
    expect(PRODUCTION_CSP).not.toMatch(/'unsafe-inline'|'unsafe-eval'|https?:|\*/);
    expect(directive(PRODUCTION_CSP, 'object-src')).toBe("object-src 'none'");
    expect(directive(PRODUCTION_CSP, 'frame-ancestors')).toBe("frame-ancestors 'none'");
  });

  it('meta CSP is the header CSP minus frame-ancestors', () => {
    expect(META_CSP).not.toContain('frame-ancestors');
    expect(PRODUCTION_CSP).toBe(`${META_CSP}; frame-ancestors 'none'`);
  });

  it('dev CSP only adds the dev server socket and inline allowances', () => {
    const dev = devCsp('http://localhost:5173');
    expect(directive(dev, 'connect-src')).toBe("connect-src 'self' ws://localhost:5173 userlib:");
    expect(directive(dev, 'script-src')).toContain("'unsafe-inline'");
    expect(directive(dev, 'default-src')).toBe("default-src 'none'");
  });
});
