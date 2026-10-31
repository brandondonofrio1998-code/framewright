/** All model lengths are inches (float64). These helpers convert at the UI boundary. */
export const MM_PER_INCH = 25.4;

export type FractionDenominator = 1 | 2 | 4 | 8 | 16 | 32 | 64;
export type MetricUnit = 'mm' | 'cm' | 'm';

export type LengthFormat =
  | { system: 'imperial'; style: 'ft-in' | 'in'; denominator: FractionDenominator }
  | { system: 'metric'; unit: MetricUnit; decimals: number };

export const DEFAULT_LENGTH_FORMAT: LengthFormat = { system: 'imperial', style: 'ft-in', denominator: 16 };

const MM_PER_METRIC_UNIT: Record<MetricUnit, number> = { mm: 1, cm: 10, m: 1000 };

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function inchesWithFraction(whole: number, numerator: number, denominator: number): string {
  if (numerator === 0) return `${whole}`;
  const g = gcd(numerator, denominator);
  const frac = `${numerator / g}/${denominator / g}`;
  return whole === 0 ? frac : `${whole} ${frac}`;
}

export function formatLength(inches: number, format: LengthFormat): string {
  if (format.system === 'metric') {
    const value = (inches * MM_PER_INCH) / MM_PER_METRIC_UNIT[format.unit];
    let text = value.toFixed(format.decimals);
    if (/^-0(\.0*)?$/.test(text)) text = text.slice(1);
    return `${text} ${format.unit}`;
  }

  const d = format.denominator;
  const ticks = Math.round(Math.abs(inches) * d);
  const sign = inches < 0 && ticks !== 0 ? '-' : '';

  if (format.style === 'in') {
    return `${sign}${inchesWithFraction(Math.floor(ticks / d), ticks % d, d)}"`;
  }
  const ticksPerFoot = 12 * d;
  const feet = Math.floor(ticks / ticksPerFoot);
  const rem = ticks - feet * ticksPerFoot;
  const inchText = inchesWithFraction(Math.floor(rem / d), rem % d, d);
  return feet === 0 ? `${sign}${inchText}"` : `${sign}${feet}'-${inchText}"`;
}

export type LengthParseResult = { ok: true; inches: number } | { ok: false; error: string };

export interface LengthParseContext {
  /** How to read a number typed without a unit: inches for imperial, `metricUnit` for metric. */
  system: 'imperial' | 'metric';
  metricUnit?: MetricUnit;
}

type Unit = 'ft' | 'in' | MetricUnit;

const UNIT_TOKENS: [string, Unit][] = [
  ['mm', 'mm'],
  ['cm', 'cm'],
  ['ft', 'ft'],
  ['in', 'in'],
  ['m', 'm'],
  ["'", 'ft'],
  ['′', 'ft'],
  ['"', 'in'],
  ['″', 'in'],
];

const TO_INCHES: Record<Unit, number> = { ft: 12, in: 1, mm: 1 / MM_PER_INCH, cm: 10 / MM_PER_INCH, m: 1000 / MM_PER_INCH };

class ParseError extends Error {}

class Scanner {
  pos = 0;
  constructor(readonly text: string) {}

  peek(offset = 0): string {
    return this.text[this.pos + offset] ?? '';
  }
  atEnd(): boolean {
    return this.pos >= this.text.length;
  }
  skipSpace(): boolean {
    const start = this.pos;
    while (/\s/.test(this.peek())) this.pos++;
    return this.pos > start;
  }
  fail(message: string): never {
    throw new ParseError(`${message} at position ${this.pos + 1}`);
  }
  isDigitAt(offset = 0): boolean {
    return /[0-9]/.test(this.peek(offset));
  }
  isNumberStart(): boolean {
    return this.isDigitAt() || (this.peek() === '.' && this.isDigitAt(1));
  }
}

function readDigits(s: Scanner): string {
  const start = s.pos;
  while (s.isDigitAt()) s.pos++;
  return s.text.slice(start, s.pos);
}

/** Reads `12`, `12.5`, `.5`, `1/2`, or `6 1/2`. */
function readMagnitude(s: Scanner): number {
  if (!s.isNumberStart()) s.fail('Expected a number');
  const intPart = readDigits(s);
  if (s.peek() === '.') {
    s.pos++;
    const fracPart = readDigits(s);
    if (intPart === '' && fracPart === '') s.fail('Expected a number');
    return Number(`${intPart || '0'}.${fracPart || '0'}`);
  }
  if (s.peek() === '/') {
    s.pos++;
    const den = readDigits(s);
    if (den === '') s.fail('Expected a denominator');
    if (Number(den) === 0) s.fail('Division by zero');
    return Number(intPart) / Number(den);
  }
  // Mixed number: "6 1/2"
  const save = s.pos;
  if (s.skipSpace() && s.isDigitAt()) {
    const num = readDigits(s);
    if (s.peek() === '/') {
      s.pos++;
      const den = readDigits(s);
      if (den === '') s.fail('Expected a denominator');
      if (Number(den) === 0) s.fail('Division by zero');
      return Number(intPart) + Number(num) / Number(den);
    }
  }
  s.pos = save;
  return Number(intPart);
}

function readUnit(s: Scanner): Unit | null {
  const save = s.pos;
  s.skipSpace();
  const rest = s.text.slice(s.pos).toLowerCase();
  for (const [token, unit] of UNIT_TOKENS) {
    if (rest.startsWith(token)) {
      const after = rest[token.length] ?? '';
      if (/[a-z]/.test(token) && /[a-z]/.test(after)) continue;
      s.pos += token.length;
      return unit;
    }
  }
  s.pos = save;
  return null;
}

/** One length: `12'`, `6 1/2"`, `12'-6 1/2"`, `12' 6"`, `3.2 m`, or a bare number. */
function readTerm(s: Scanner, ctx: LengthParseContext): number {
  const magnitude = readMagnitude(s);
  const unit = readUnit(s) ?? (ctx.system === 'imperial' ? 'in' : (ctx.metricUnit ?? 'mm'));
  let inches = magnitude * TO_INCHES[unit];

  if (unit === 'ft') {
    // A dash directly after the foot mark separates feet from inches: 12'-6".
    const save = s.pos;
    if (s.peek() === '-' && (s.isDigitAt(1) || s.peek(1) === '.')) {
      s.pos++;
    } else {
      s.skipSpace();
    }
    if (s.isNumberStart()) {
      const inchPart = readMagnitude(s);
      const inchUnit = readUnit(s);
      if (inchUnit !== null && inchUnit !== 'in') s.fail('Expected inches after feet');
      inches += inchPart;
    } else {
      s.pos = save;
    }
  }
  return inches;
}

/**
 * Parses a typed length into inches. Supports ft-in (`12'6"`, `12'-6 1/2"`, `12-6`),
 * inches (`150`, `6 1/2"`), metric (`150mm`, `3.2 m`) and `+`/`-` between terms.
 * Subtraction needs spaces (`10' - 3"`); `10'-3"` is ten feet three inches.
 */
export function parseLength(text: string, ctx: LengthParseContext): LengthParseResult {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, error: 'Enter a length' };

  if (ctx.system === 'imperial') {
    const dash = /^(-?)(\d+)-(\d+(?:\.\d+)?|\d+\s+\d+\/\d+|\d+\/\d+)$/.exec(trimmed);
    if (dash) {
      const inchResult = parseLength(dash[3] ?? '', ctx);
      if (!inchResult.ok) return inchResult;
      const value = Number(dash[2]) * 12 + inchResult.inches;
      return { ok: true, inches: dash[1] === '-' ? -value : value };
    }
  }

  const s = new Scanner(trimmed);
  try {
    let sign = 1;
    if (s.peek() === '-' || s.peek() === '+') {
      sign = s.peek() === '-' ? -1 : 1;
      s.pos++;
      s.skipSpace();
    }
    let total = sign * readTerm(s, ctx);
    for (;;) {
      s.skipSpace();
      if (s.atEnd()) break;
      const op = s.peek();
      if (op !== '+' && op !== '-') s.fail(`Unexpected "${op}"`);
      s.pos++;
      s.skipSpace();
      const term = readTerm(s, ctx);
      total += op === '+' ? term : -term;
    }
    if (!Number.isFinite(total)) return { ok: false, error: 'Length is out of range' };
    return { ok: true, inches: total };
  } catch (error) {
    if (error instanceof ParseError) return { ok: false, error: error.message };
    throw error;
  }
}
