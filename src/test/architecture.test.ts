import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

/**
 * Architecture is a test, not a review comment (`common.testing`): a PURE module never imports `vscode`
 * or a `node:` API, because page modules are plain functions from values to strings and what they render
 * is a unit test. The gate accepted this scan for the plan; the HOST modules that may import either are
 * named in an explicit allowlist, and a file in it that does not exist yet is simply not scanned.
 *
 * The scan is textual, line by line. A comment quoting one of the four shapes verbatim would be reported
 * too — so a pure module describes the rule in words rather than quoting the import.
 */

/** `src/`, resolved from the compiled test's own location (`out/test/`), so the cwd does not matter. */
const SRC = path.resolve(__dirname, '..', '..', 'src');
const TESTS = 'src/test/';
/** Host modules, allowed to import `vscode` and `node:`. Spelled from the repository root, with `/`. */
const HOST_ALLOWLIST: readonly string[] = ['src/webview/nonce.ts'];

interface Shape {
  readonly pattern: RegExp;
  readonly what: string;
}

const HOST_SHAPES: readonly Shape[] = [
  { pattern: /\bfrom\s+['"]node:/, what: "imports from 'node:…'" },
  { pattern: /\brequire\(\s*['"]node:/, what: "requires 'node:…'" },
  { pattern: /\bfrom\s+['"]vscode['"]/, what: "imports from 'vscode'" },
  { pattern: /\brequire\(\s*['"]vscode['"]\s*\)/, what: "requires 'vscode'" },
];

/** `src/...` with forward slashes — how the allowlist and the exclusion spell a path on every OS. */
function fromRoot(file: string): string {
  return path.relative(path.dirname(SRC), file).split(path.sep).join('/');
}

function isPure(relative: string): boolean {
  return !relative.startsWith(TESTS) && !HOST_ALLOWLIST.includes(relative);
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

/** Every host import in one file's text, as `file:line — what`. */
function hostImportsIn(file: string, text: string): string[] {
  return text.split('\n').flatMap((line, index) =>
    HOST_SHAPES.filter((shape) => shape.pattern.test(line)).map((shape) => `${file}:${index + 1} — ${shape.what}`),
  );
}

test('no pure module imports vscode or a node: API', () => {
  const files = tsFilesUnder(SRC).filter((file) => isPure(fromRoot(file)));
  assert.ok(files.length > 0, 'the scan found no pure module under src/ — the walk is broken or src/ is empty');

  const findings = files.flatMap((file) => hostImportsIn(fromRoot(file), fs.readFileSync(file, 'utf8')));

  assert.deepEqual(findings, [], `host imports in pure modules:\n${findings.join('\n')}`);
});

test('the scan detects every host-import shape in a fixture, so the prohibition cannot pass vacuously', () => {
  const fixture = [
    "import { a } from './a';",
    "import * as fs from 'node:fs';",
    'const p = require("node:path");',
    "import * as vscode from 'vscode';",
    "const v = require('vscode');",
    "export const text = 'node:fs is only text here';",
  ].join('\n');

  assert.deepEqual(hostImportsIn('src/fixture.ts', fixture), [
    "src/fixture.ts:2 — imports from 'node:…'",
    "src/fixture.ts:3 — requires 'node:…'",
    "src/fixture.ts:4 — imports from 'vscode'",
    "src/fixture.ts:5 — requires 'vscode'",
  ]);
});

test('src/test/ and the host allowlist are outside the scan, whether or not the allowlisted file exists yet', () => {
  assert.equal(isPure('src/index.ts'), true);
  assert.equal(isPure('src/webview/escape.ts'), true);
  assert.equal(isPure('src/test/pageHarness.ts'), false);
  assert.equal(isPure('src/webview/nonce.ts'), false);
});
