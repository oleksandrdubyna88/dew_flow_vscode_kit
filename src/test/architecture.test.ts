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

// ---------------------------------------------------------------------------------------------------
// One hop away (E2.S3): the per-file scan above cannot see a pure-looking module that IMPORTS a host
// module. The help page takes its nonce as a parameter precisely so that it stays pure; the panel, its host
// half, mints one. So the page modules' whole runtime import closure must stay clear of the host allowlist
// — and the panel's must reach it, which is the known instance that keeps this check from passing vacuously.
// ---------------------------------------------------------------------------------------------------

/** The modules a webview page is rendered by: nothing in their closure may reach a host module. */
const PAGE_MODULES: readonly string[] = ['src/help/page.ts', 'src/help/messages.ts', 'src/display/zoom.ts', 'src/display/tone.ts', 'src/display/press.ts'];

/**
 * The relative modules a file imports at RUN time, as `src/...` paths. A whole statement is matched across
 * lines (a multi-line `import {` is the common shape); `import type` and `export type` are erased by the
 * compiler and bring nothing, so they are skipped.
 */
function runtimeImportsOf(file: string, text: string): string[] {
  // `from` is optional: `import './effect';` brings a module with no binding, and it runs.
  const statements = text.matchAll(/^\s*(?:import|export)\s+(type\s+)?(?:[^;]*?\bfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/gms);

  return [...statements]
    .filter(([, typeOnly]) => typeOnly === undefined)
    .map(([, , target]) => fromRoot(path.resolve(path.dirname(path.join(path.dirname(SRC), file)), `${target ?? ''}.ts`)));
}

/** Every module reachable from `start` through run-time imports, `start` included. */
function closureOf(start: string): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) {
      return;
    }
    seen.add(file);
    runtimeImportsOf(file, fs.readFileSync(path.join(path.dirname(SRC), file), 'utf8')).forEach(visit);
  };
  visit(start);

  return seen;
}

test('no module a page is rendered by reaches a host module through its imports — the nonce stays a parameter', () => {
  const findings = PAGE_MODULES.flatMap((module) =>
    [...closureOf(module)].filter((file) => HOST_ALLOWLIST.includes(file)).map((file) => `${module} reaches ${file}`),
  );

  assert.deepEqual(findings, [], findings.join('\n'));
  assert.ok(closureOf('src/help/page.ts').has('src/help/catalog.ts'), 'the walk did not follow page.ts into the catalog');
});

test('the closure walk finds the known host reach: the panel mints its nonce, and the index re-exports it', () => {
  assert.ok(closureOf('src/help/panel.ts').has('src/webview/nonce.ts'));
  assert.ok(closureOf('src/index.ts').has('src/webview/nonce.ts'));
});

test('the closure walk reads EVERY run-time import shape — a side-effect import and a multi-line list included — and skips the type-only ones', () => {
  const fixture = [
    "import { a } from './a';",
    "import './effect';",
    "export * from './star';",
    "export { b } from '../up/b';",
    "import type { T } from './types';",
    "export type { U } from './types2';",
    'import {',
    '  c,',
    "} from './multi';",
    "import 'not-relative';",
  ].join('\n');

  assert.deepEqual(runtimeImportsOf('src/components/x.ts', fixture), [
    'src/components/a.ts', 'src/components/effect.ts', 'src/components/star.ts', 'src/up/b.ts', 'src/components/multi.ts',
  ]);
});

// ---------------------------------------------------------------------------------------------------
// The components entry (`todo/PLAN_kit_components_storybook.md` §4.2): it is bundled by a consumer FOR THE BROWSER,
// so its whole run-time closure must stay inside `src/components/` — no host module, no `node:`, nothing of the root
// entry (which reaches `nonce.ts`). The root entry keeps reaching `nonce.ts`, which is the known instance above.
// ---------------------------------------------------------------------------------------------------

const COMPONENTS_ENTRY = 'src/components/index.ts';

test('the components entry\'s run-time closure stays inside src/components/ and reaches no host module', () => {
  const closure = [...closureOf(COMPONENTS_ENTRY)];
  const outside = closure.filter((file) => !file.startsWith('src/components/'));

  assert.deepEqual(outside, [], `the components entry reaches ${outside.join(', ')}`);
  assert.ok(closure.includes('src/components/dataTable.ts') && closure.includes('src/components/tableOrder.ts'), `the walk did not follow the entry: ${closure.join(', ')}`);
});

test('every component module is a page module: none of them imports vscode or node:, even one hop away', () => {
  const files = tsFilesUnder(path.join(SRC, 'components')).map(fromRoot);
  assert.ok(files.length >= 7, `only ${files.length} component modules found`);
  const findings = files.flatMap((file) => [...closureOf(file)].filter((reached) => HOST_ALLOWLIST.includes(reached)).map((reached) => `${file} reaches ${reached}`));

  assert.deepEqual(findings, []);
});

test('the import reader takes multi-line, export-from and relative-parent imports, and skips type-only ones', () => {
  const fixture = [
    "import { a } from './a';",
    'import {',
    '  b,',
    "} from '../b';",
    "import type { C } from './c';",
    "export { d } from './d';",
    "export type { E } from './e';",
    "import * as fs from 'node:fs';",
  ].join('\n');

  assert.deepEqual(runtimeImportsOf('src/help/x.ts', fixture), ['src/help/a.ts', 'src/b.ts', 'src/help/d.ts']);
});
