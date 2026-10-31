// Fails if runtime code (sources or the built bundle) contains a network URL.
// Tests, docs, and build tooling are out of scope: they never ship in the app.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export const SOURCE_ROOTS = ['packages/core/src', 'packages/catalog/src', 'apps/desktop/src'];
export const BUILD_ROOTS = ['apps/desktop/out'];

const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.html', '.css', '.json', '.svg']);
const URL_PATTERN = /\b(?:https?|wss?|ftp):\/\/[^\s'"`<>()\\]*/gi;

/**
 * Strings that look like URLs but are never fetched. Every entry needs a reason.
 * Scope `where: 'build'` means the string only exists inside bundled third-party code.
 */
export const ALLOWLIST = [
  { pattern: /^https:\/\/react\.dev\/errors\/$/, where: 'build', reason: 'Text inside React production error messages ("visit … for the full message"); never requested' },
  { pattern: /^https?:\/\/json-schema\.org\/(draft-0[47]\/schema#|draft\/2020-12\/schema)$/, where: 'build', reason: 'JSON Schema `$schema` identifiers emitted by zod’s schema exporter; identifiers, never requested' },
  { pattern: /^http:\/\/\[\$\{e\}\]$/, where: 'build', reason: 'zod’s IPv6 validator parses `http://[addr]` with `new URL()` to check syntax; never requested' },
  { pattern: /^https:\/\/bit\.ly\/3cXEKWf$/, where: 'build', reason: 'Text inside an Immer error message; never requested' },
  { pattern: /^http:\/\/www\.w3\.org\/(2000\/svg|1999\/xlink|1999\/xhtml|1998\/Math\/MathML|XML\/1998\/namespace|2000\/xmlns\/?)$/, where: 'any', reason: 'XML namespace identifiers used by the DOM, never requested' },
  { pattern: /^https:\/\/github\.com\/(drcmda|joshuaellis|codyjasonbennett|krispya)$/, where: 'build', reason: 'Author URLs copied from react-three-fiber package metadata; never requested' },
  { pattern: /^https:\/\/github\.com\/pmndrs\/react-three-fiber(\/issues|#readme|\.git)$/, where: 'build', reason: 'react-three-fiber package.json links (bugs, homepage, repository); never requested' },
  { pattern: /^https:\/\/opencollective\.com\/react-three-fiber$/, where: 'build', reason: 'react-three-fiber funding link from package metadata; never requested' },
  { pattern: /^https:\/\/docs\.pmnd\.rs\/react-three-fiber\/api\/objects#using-3rd-party-objects-declaratively$/, where: 'build', reason: 'Comment inside react-three-fiber pointing at its docs; never requested' },
  { pattern: /^https:\/\/github\.com\/react-spring\/react-use-measure\/#resize-observer-polyfills$/, where: 'build', reason: 'Comment inside @react-spring/use-measure (pulled in by react-three-fiber); never requested' },
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules') continue;
      yield* walk(full);
    } else {
      const dot = name.lastIndexOf('.');
      if (dot >= 0 && SCANNED_EXTENSIONS.has(name.slice(dot)) && !/\.test\.[cm]?[jt]sx?$/.test(name)) yield full;
    }
  }
}

function isAllowed(url, where) {
  return ALLOWLIST.some((entry) => (entry.where === 'any' || entry.where === where) && entry.pattern.test(url));
}

/** @returns {{ file: string, line: number, url: string }[]} */
export function findForbiddenUrls({ includeBuild }) {
  const findings = [];
  const scopes = [...SOURCE_ROOTS.map((r) => [r, 'source']), ...(includeBuild ? BUILD_ROOTS.map((r) => [r, 'build']) : [])];
  for (const [root, where] of scopes) {
    const abs = join(repoRoot, root);
    if (!existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const rel = relative(repoRoot, file).split(sep).join('/');
      for (const hit of scanText(readFileSync(file, 'utf8'), where)) findings.push({ file: rel, ...hit });
    }
  }
  return findings;
}

/** @returns {{ line: number, url: string }[]} */
export function scanText(text, where) {
  const hits = [];
  text.split('\n').forEach((lineText, index) => {
    for (const match of lineText.matchAll(URL_PATTERN)) {
      const url = match[0].replace(/[.,;:]+$/, '');
      if (!isAllowed(url, where)) hits.push({ line: index + 1, url });
    }
  });
  return hits;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const buildDir = join(repoRoot, BUILD_ROOTS[0]);
  if (!existsSync(buildDir)) {
    console.error(`check-offline: ${BUILD_ROOTS[0]} not found. Run "npm run build" first.`);
    process.exit(1);
  }
  const findings = findForbiddenUrls({ includeBuild: true });
  if (findings.length > 0) {
    console.error('check-offline: network URLs found in runtime code:');
    for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.url}`);
    process.exit(1);
  }
  console.log('check-offline: no network URLs in runtime sources or build output.');
}
