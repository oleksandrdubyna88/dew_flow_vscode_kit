import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import { FakeDocument } from './fakeDom';
import { GALLERY } from './gallery';
import { listAt, mapAt, parseWorkflow } from './workflowYaml';

/**
 * What the layout check stands on, without a browser (`todo/PLAN_kit_components_storybook.md` §4.6a, §5.2 items 27-28).
 * The check itself runs Chrome - `npm run layout-check`, and its companion `npm run layout-check -- --companion` - in
 * CI's storybook job; these tests hold what it needs to be worth running: the gallery has the cases that would break
 * it, CI really runs both modes, a missing browser is a failed run rather than a skip, and a wrong argument is a usage
 * error.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'layout-check.mjs');

const tableCases = (): readonly { id: string; render: (doc: FakeDocument) => unknown }[] => {
  const cases = GALLERY.find((component) => component.id === 'dataTable')?.cases ?? [];

  return cases.flatMap((entry) => (entry.kind === 'dom' ? [{ id: entry.id, render: (doc: FakeDocument) => entry.render(doc) }] : []));
};

function rendered(id: string): { doc: FakeDocument; root: ReturnType<FakeDocument['node']> } {
  const doc = new FakeDocument();
  const found = tableCases().find((entry) => entry.id === id) ?? assert.fail(`the gallery has no dataTable/${id}`);

  return { doc, root: doc.node(found.render(doc)) };
}

test('the gallery has the DataTable cases that would break "a table fits its box": eight columns in an 18em box, an unbreakable word, a long header, and a stacked case per width', () => {
  assert.deepEqual(['eight-columns', 'unbreakable-cell', 'long-header', 'stack-narrow', 'stack-medium', 'stack-wide', 'stack-never'].filter((id) => !tableCases().some((entry) => entry.id === id)), []);

  const eight = rendered('eight-columns').root;
  assert.ok(eight.classes.includes('gallery-narrow'), 'the eight-column table is not in the narrow box');
  assert.equal(eight.all('th').length, 8);

  const words = rendered('unbreakable-cell').root.all('td').map((cell) => cell.textContent).flatMap((text) => text.split(/\s+/));
  assert.ok(Math.max(...words.map((word) => word.length)) >= 60, 'no cell holds a word of 60 characters or more');

  const headers = rendered('long-header').root.all('th').map((cell) => cell.textContent);
  assert.ok(Math.max(...headers.map((header) => header.length)) >= 40, 'no header is 40 characters or longer');

  for (const stack of ['narrow', 'medium', 'wide', 'never']) {
    assert.equal(rendered(`stack-${stack}`).root.all(`table.kit-table--stack-${stack}`).length, 1, `stack-${stack} does not render its stack option`);
  }
});

test('package.json has the layout-check script and CI\'s storybook job runs it AND its companion, after the build', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  assert.equal(manifest.scripts['layout-check'], 'node scripts/layout-check.mjs');

  const ci = mapAt(parseWorkflow(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')), 'ci.yml');
  const job = mapAt(mapAt(ci['jobs'], 'jobs')['storybook'], 'storybook');
  assert.equal(job['runs-on'], 'ubuntu-latest', 'Google Chrome is on GitHub\'s ubuntu image');
  const runs = listAt(job['steps'], 'steps').flatMap((step) => {
    const run = mapAt(step, 'a step')['run'];

    return typeof run === 'string' ? [run] : [];
  });
  assert.ok(runs.includes('npm run layout-check'), `the layout check is not a step: ${runs.join(' | ')}`);
  assert.ok(runs.includes('npm run layout-check -- --companion'), 'the companion is not a step');
  assert.ok(runs.indexOf('npm run build-storybook') < runs.indexOf('npm run layout-check'), 'the layout check must come after the Storybook build');
});

/**
 * The script run with its browser lookup pointed at nothing. A `CHROME_PATH` naming a missing file is the lookup every
 * platform honours; on Linux the PATH search can be emptied too (Windows resets `ProgramFiles` for a child process, so
 * its install-path search cannot be hidden from a test).
 */
function withoutChrome(args: readonly string[], env: NodeJS.ProcessEnv): { status: number | null; said: string } {
  const ran = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 240_000, env: { ...process.env, ...env } });
  assert.equal(ran.error, undefined, `could not run: ${String(ran.error)}`);

  return { status: ran.status, said: `${ran.stdout}${ran.stderr}` };
}

function noProfileLeft(): void {
  assert.equal(fs.existsSync(path.join(ROOT, 'testsToDelete-layout-check')), false, 'the profile folder was left behind');
}

test('a CHROME_PATH that names nothing FAILS the check saying so - exit 3, never a skip, never another browser - and leaves no profile folder', { timeout: 300_000 }, () => {
  const missing = path.join(os.tmpdir(), 'kit-no-such-chrome', 'chrome');
  const { status, said } = withoutChrome([], { CHROME_PATH: missing });

  assert.equal(status, 3, said);
  assert.match(said, /CHROME_PATH is set to .*kit-no-such-chrome.*which does not exist/);
  noProfileLeft();
});

test('with no browser anywhere on PATH (Linux) the check FAILS saying so - exit 3 - and leaves no profile folder', { timeout: 300_000 }, () => {
  if (process.platform !== 'linux') {
    // Only Linux searches PATH; the CHROME_PATH test above is the other platforms' proof of the same exit.
    return;
  }
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-no-chrome-'));
  try {
    const { status, said } = withoutChrome([], { CHROME_PATH: '', PATH: empty });

    assert.equal(status, 3, said);
    assert.match(said, /no Chrome found: set CHROME_PATH/);
    noProfileLeft();
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('an unknown argument is a usage error, exit 2, before any browser is looked for', { timeout: 300_000 }, () => {
  const { status, said } = withoutChrome(['--everything'], {});

  assert.equal(status, 2, said);
  assert.match(said, /usage: node scripts\/layout-check\.mjs \[--companion\]/);
});
