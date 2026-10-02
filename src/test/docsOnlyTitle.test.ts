import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

/**
 * Documentation alone never opens a release (the family operator's rule, 2026-09-26) — the step pr-title.yml
 * runs, `.github/scripts/docs-only-title.mjs`, copied from ConnectOtherAIs (main at 85085850) with its tests,
 * which are ported here and adapted to the one difference: this repository's package is the ROOT (`.`), so
 * every file a commit touches is in the package except what `exclude-paths` drops (`.github`). Run as the
 * workflow runs it, over the same facts, against this repository's own `release-please-config.json`.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, '.github', 'scripts', 'docs-only-title.mjs');

const FINE = 0;
const REFUSED = 1;
const UNREADABLE = 2;

interface Commit {
  readonly sha: string;
  readonly message: string;
  readonly files: readonly string[];
}

function check(title: string, files: readonly string[], commits: readonly Commit[] = []): { code: number; said: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-docsonly-'));
  try {
    const facts = path.join(dir, 'facts.json');
    fs.writeFileSync(facts, JSON.stringify({ title, files, commits }), 'utf8');
    const ran = spawnSync(process.execPath, [SCRIPT, '--facts', facts], { encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL' });
    assert.equal(ran.error, undefined, `could not run: ${String(ran.error)}`);
    assert.notEqual(ran.status, null, `did not exit on its own (signal ${String(ran.signal)})`);

    return { code: ran.status as number, said: `${ran.stdout}${ran.stderr}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('a releasing title over Markdown alone is refused, for every releasing type — the package is the root, so README.md is in it', () => {
  for (const title of ['feat: a new page', 'fix(docs): a typo', 'perf: faster prose', 'revert: the old words', 'docs!: renamed']) {
    const { code, said } = check(title, ['README.md']);
    assert.equal(code, REFUSED, `"${title}" would open a release for a README: ${said}`);
    assert.match(said, /would release \. on documentation alone \(README\.md\)/, 'and the refusal names the package and the file');
  }
});

test('plans and research notes are documentation too — the root package has no "outside"', () => {
  const { code, said } = check('feat: the plan', ['todo/PLAN_x.md', 'research/module_x.md']);

  assert.equal(code, REFUSED, said);
});

test('the same change said as docs: passes', () => {
  assert.equal(check('docs: a new page', ['README.md', 'research/architecture.md']).code, FINE);
});

test('pictures count as documentation; a picture beside code is code enough', () => {
  for (const picture of ['assets/shot.png', 'docs/flow.svg', 'a.JPG', 'b.jpeg', 'c.gif', 'd.webp']) {
    assert.equal(check('feat: the pictures', ['README.md', picture]).code, REFUSED, `${picture} beside a README`);
  }
  assert.equal(check('feat: the icon and its use', ['media/icon.png', 'src/help/page.ts']).code, FINE);
});

test('a releasing title with code in it passes, Markdown beside it or not', () => {
  assert.equal(check('feat: the thing', ['src/display/host.ts', 'README.md']).code, FINE);
});

test('files under .github are dropped first, as release-please\'s exclude-paths drops them', () => {
  // A `.github`-only commit is skipped by release-please, so it opens no release and is not refused…
  assert.equal(check('feat(ci): a workflow', ['.github/workflows/release.yml']).code, FINE);
  // …but a README riding with it is still released — release-please keeps a commit with ANY file outside
  // an exclude path — so that one is refused, naming only the README.
  const { code, said } = check('feat(ci): a workflow and its README', ['.github/workflows/release.yml', 'README.md']);
  assert.equal(code, REFUSED, said);
  assert.match(said, /\(README\.md\)/);
  assert.doesNotMatch(said, /release\.yml/);
});

test('a Markdown-only COMMIT of a releasing type is refused even under a docs: title — a rebase merge keeps it', () => {
  const { code, said } = check('docs: the notes', ['README.md'],
    [{ sha: 'a'.repeat(40), message: 'fix: the readme\n\nbody', files: ['README.md'] }]);

  assert.equal(code, REFUSED, 'release-please reads this commit under a rebase merge');
  assert.match(said, /aaaaaaaa/, 'and the refusal names the commit');
});

test('facts it cannot read are refused, not passed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-docsonly-'));
  try {
    const facts = path.join(dir, 'facts.json');
    fs.writeFileSync(facts, JSON.stringify({ title: 'feat: x' }), 'utf8');
    const ran = spawnSync(process.execPath, [SCRIPT, '--facts', facts], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(ran.status, UNREADABLE, 'facts without files or commits cannot be judged');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
