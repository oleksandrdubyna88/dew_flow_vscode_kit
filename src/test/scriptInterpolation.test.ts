import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

/**
 * `typescript.doctrine` § 1: never interpolate into a `<script>` with `JSON.stringify` — an HTML parser
 * ends a script element at the first `</script>` it meets, inside a string literal included, so a value
 * carrying one runs whatever follows. The kit's one road into a script body is `jsonForScript`, and this
 * scan is the control that keeps it the one road: every shipped source is read, and a `${JSON.stringify(`
 * anywhere in it fails naming file and line (`common.security`: leave the enumeration behind as a test).
 *
 * The scan is textual and cannot tell a page template from an error message, so the two error messages
 * that quote a value with `JSON.stringify` are allowlisted by their EXACT line — a companion test fails
 * when an allowlisted line is no longer where it is said to be, so the allowlist cannot go stale in the
 * direction that keeps it green. A third test proves the pattern still matches a known instance.
 */

const SRC = path.resolve(__dirname, '..', '..', 'src');
const TESTS = 'src/test/';
const SHAPE = /\$\{\s*JSON\.stringify\(/;

interface Allowed {
  readonly file: string;
  /** The trimmed text of the line, exactly. */
  readonly line: string;
  readonly why: string;
}

const ALLOWED: readonly Allowed[] = [
  {
    file: 'src/display/config.ts',
    line: '`CSS prefix ${JSON.stringify(prefix)} is not usable: it must be lowercase letters, digits and dashes, starting with a letter.`,',
    why: 'the TypeError a bad CSS prefix raises — text for a person, never a page',
  },
  {
    file: 'src/help/page.ts',
    line: 'throw new TypeError(`A CSP nonce is at least 22 base64 characters, as nonce() mints one; got ${JSON.stringify(nonce)}.`);',
    why: 'the TypeError a bad nonce raises — text for a person, never a page',
  },
];

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

function fromRoot(file: string): string {
  return path.relative(path.dirname(SRC), file).split(path.sep).join('/');
}

function tsFilesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return tsFilesUnder(full);
    }

    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

/** Every line of `text` carrying the shape, as `{ file, line, text }`. */
function findingsIn(file: string, text: string): Finding[] {
  return text.split('\n').flatMap((line, index) => (SHAPE.test(line) ? [{ file, line: index + 1, text: line.trim() }] : []));
}

function isAllowed(finding: Finding): boolean {
  return ALLOWED.some((allowed) => allowed.file === finding.file && allowed.line === finding.text);
}

const shipped = (): string[] => tsFilesUnder(SRC).filter((file) => !fromRoot(file).startsWith(TESTS));

test('no shipped source interpolates JSON.stringify into a template literal, outside the allowlisted error messages', () => {
  const files = shipped();
  assert.ok(files.length > 0, 'the scan found no shipped source under src/');

  const findings = files.flatMap((file) => findingsIn(fromRoot(file), fs.readFileSync(file, 'utf8'))).filter((finding) => !isAllowed(finding));

  assert.deepEqual(findings, [], `JSON.stringify interpolated into a template literal:\n${findings.map((f) => `${f.file}:${f.line} — ${f.text}`).join('\n')}`);
});

test('every allowlisted line is still exactly where it is said to be — a stale allowlist entry is red', () => {
  for (const allowed of ALLOWED) {
    const text = fs.readFileSync(path.join(path.dirname(SRC), allowed.file), 'utf8');
    const found = findingsIn(allowed.file, text).filter((finding) => finding.text === allowed.line);
    assert.equal(found.length, 1, `${allowed.file}: the allowlisted line (${allowed.why}) was found ${found.length} times`);
  }
});

test('the scan finds the shape in a fixture in every spelling, and leaves the sanctioned escaper alone', () => {
  const fixture = [
    "const page = `<script>var rows = ${JSON.stringify(rows)};</script>`;",
    'const loose = `${ JSON.stringify( rows ) }`;',
    'const safe = `<script>var rows = ${jsonForScript(rows)};</script>`;',
    "const text = JSON.stringify(value).replace(/</g, '\\\\u003c');",
  ].join('\n');

  assert.deepEqual(findingsIn('src/fixture.ts', fixture).map((f) => f.line), [1, 2]);
});
