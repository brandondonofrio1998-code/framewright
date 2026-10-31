import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatLength, parseLength, type LengthFormat, type LengthParseContext } from '../../src/units/length';

const FT_IN: LengthFormat = { system: 'imperial', style: 'ft-in', denominator: 16 };
const IN: LengthFormat = { system: 'imperial', style: 'in', denominator: 16 };
const IMPERIAL: LengthParseContext = { system: 'imperial' };
const METRIC: LengthParseContext = { system: 'metric', metricUnit: 'mm' };

const parse = (text: string, ctx = IMPERIAL) => {
  const r = parseLength(text, ctx);
  if (!r.ok) throw new Error(`parse failed for ${text}: ${r.error}`);
  return r.inches;
};

describe('formatLength', () => {
  it.each([
    [150.5, `12'-6 1/2"`],
    [144, `12'-0"`],
    [6, `6"`],
    [0.5, `1/2"`],
    [0, `0"`],
    [-150.5, `-12'-6 1/2"`],
    [11.99, `1'-0"`],
    [97.125, `8'-1 1/8"`],
    [0.03125, `1/16"`],
  ])('ft-in %d → %s', (inches, expected) => {
    expect(formatLength(inches, FT_IN)).toBe(expected);
  });

  it('rounds to the configured fraction and carries into feet', () => {
    expect(formatLength(143.99, FT_IN)).toBe(`12'-0"`);
    expect(formatLength(10.3, { ...FT_IN, denominator: 4 })).toBe(`10 1/4"`);
    expect(formatLength(-0.01, FT_IN)).toBe(`0"`);
  });

  it('formats inches-only and metric', () => {
    expect(formatLength(150.5, IN)).toBe(`150 1/2"`);
    expect(formatLength(150.5, { system: 'metric', unit: 'mm', decimals: 0 })).toBe('3823 mm');
    expect(formatLength(150.5, { system: 'metric', unit: 'cm', decimals: 1 })).toBe('382.3 cm');
    expect(formatLength(150.5, { system: 'metric', unit: 'm', decimals: 3 })).toBe('3.823 m');
    expect(formatLength(-0.001, { system: 'metric', unit: 'mm', decimals: 0 })).toBe('0 mm');
  });
});

describe('parseLength', () => {
  it.each([
    [`12'6"`, 150],
    [`12' 6"`, 150],
    [`12'-6"`, 150],
    [`12'-6 1/2"`, 150.5],
    [`12' 6 1/2"`, 150.5],
    [`12'6`, 150],
    [`12'`, 144],
    [`12.5'`, 150],
    [`12ft 6in`, 150],
    [`6"`, 6],
    [`6 1/2"`, 6.5],
    [`1/2"`, 0.5],
    [`.5"`, 0.5],
    [`150`, 150],
    [`150.25`, 150.25],
    [`12-6`, 150],
    [`12-6 1/2`, 150.5],
    [`-6"`, -6],
    [`12′6″`, 150],
  ])('imperial %s → %d in', (text, inches) => {
    expect(parse(text)).toBeCloseTo(inches, 9);
  });

  it('evaluates + and - between terms; spaced dash is subtraction', () => {
    expect(parse(`10'+3 1/2"`)).toBeCloseTo(123.5, 9);
    expect(parse(`10' - 3"`)).toBeCloseTo(117, 9);
    expect(parse(`10'-3"`)).toBeCloseTo(123, 9);
    expect(parse(`12 - 6`)).toBeCloseTo(6, 9);
    expect(parse(`1m + 2"`)).toBeCloseTo(1000 / 25.4 + 2, 9);
  });

  it('reads metric units, with bare numbers in the context unit', () => {
    expect(parse('150mm')).toBeCloseTo(150 / 25.4, 9);
    expect(parse('15 cm')).toBeCloseTo(150 / 25.4, 9);
    expect(parse('3.2m')).toBeCloseTo(3200 / 25.4, 9);
    expect(parse('254', METRIC)).toBeCloseTo(10, 9);
    expect(parse('25.4', { system: 'metric', metricUnit: 'cm' })).toBeCloseTo(10, 9);
  });

  it.each(['', '   ', 'abc', `12''`, '1/0"', `6" 3'`, '12 +', `5mm-`, `12'-6mm`, '12mmm'])('rejects %j', (text) => {
    expect(parseLength(text, IMPERIAL).ok).toBe(false);
  });

  it('reports where parsing failed', () => {
    const r = parseLength('12 x 3', IMPERIAL);
    expect(r).toEqual({ ok: false, error: 'Unexpected "x" at position 4' });
  });
});

describe('format → parse round trip', () => {
  it('ft-in at 1/16" is exact for any multiple of 1/16"', () => {
    fc.assert(
      fc.property(fc.integer({ min: -200_000, max: 200_000 }), (ticks) => {
        const inches = ticks / 16;
        expect(parse(formatLength(inches, FT_IN))).toBeCloseTo(inches, 9);
        expect(parse(formatLength(inches, IN))).toBeCloseTo(inches, 9);
      }),
    );
  });

  it('metric mm at 3 decimals round-trips within 0.001 mm', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e5, max: 1e5, noNaN: true }), (inches) => {
        const text = formatLength(inches, { system: 'metric', unit: 'mm', decimals: 3 });
        expect(Math.abs(parse(text, METRIC) - inches) * 25.4).toBeLessThanOrEqual(0.0005 + 1e-9);
      }),
    );
  });
});
