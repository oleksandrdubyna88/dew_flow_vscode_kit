import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

/**
 * `scripts/copy-css.mjs` against a throwaway copy of the repository's shape (`package.json`, `scripts/`, `src/`), so a
 * manifest with a bad `exports` target can be tried without touching the real tree: the script derives its root from its own
 * location, which is why it is COPIED into the temporary root rather than pointed at one. Run as `npm run build` runs it.
 */

const SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'copy-css.mjs');

interface Outcome {
  readonly status: number | null;
  readonly said: string;
  readonly root: string;
  readonly outside: string;
}

/** Runs the script in a fresh root whose manifest exports `targets`; `src/components/a.css` exists, and so does `<parent>/outside.css`. */
function run(targets: readonly string[]): Outcome {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-copy-css-'));
  const root = path.join(parent, 'root');
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'components'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(root, 'scripts', 'copy-css.mjs'));
  fs.writeFileSync(path.join(root, 'src', 'components', 'a.css'), '.kit { color: red; }\n');
  fs.writeFileSync(path.join(parent, 'outside.css'), '.outside { color: blue; }\n');
  const exportsMap = Object.fromEntries(targets.map((target, index) => [`./css-${index}`, target]));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', exports: exportsMap }));
  const ran = spawnSync(process.execPath, [path.join(root, 'scripts', 'copy-css.mjs')], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(ran.error, undefined, `could not run: ${String(ran.error)}`);

  return { status: ran.status, said: `${ran.stdout}${ran.stderr}`, root, outside: parent };
}

function gone(outcome: Outcome): void {
  fs.rmSync(outcome.outside, { recursive: true, force: true });
}

test('a target under dist/ with its source under src/ is copied beside the compiled modules', () => {
  const outcome = run(['./dist/components/a.css']);
  try {
    assert.equal(outcome.status, 0, outcome.said);
    assert.equal(fs.readFileSync(path.join(outcome.root, 'dist', 'components', 'a.css'), 'utf8'), '.kit { color: red; }\n');
  } finally {
    gone(outcome);
  }
});

test('a target that is not under dist/ says so, and a target with no source says THAT - two different messages, each exit 1', () => {
  const notDist = run(['./lib/a.css']);
  const noSource = run(['./dist/components/missing.css']);
  try {
    assert.equal(notDist.status, 1, notDist.said);
    assert.match(notDist.said, /copy-css: \.\/lib\/a\.css is not under dist\//);
    assert.doesNotMatch(notDist.said, /has no source/);
    assert.equal(noSource.status, 1, noSource.said);
    assert.match(noSource.said, /copy-css: \.\/dist\/components\/missing\.css has no source at /);
    assert.doesNotMatch(noSource.said, /is not under dist/);
  } finally {
    gone(notDist);
    gone(noSource);
  }
});

test('a target that climbs out of dist/ ("dist/../../outside.css") is refused with its own message, copies nothing and writes nothing outside the root', () => {
  const outcome = run(['./dist/../../outside.css']);
  try {
    assert.equal(outcome.status, 1, `it was accepted: ${outcome.said}`);
    assert.match(outcome.said, /copy-css: \.\/dist\/\.\.\/\.\.\/outside\.css resolves outside dist\/ or src\//);
    assert.equal(fs.readFileSync(path.join(outcome.outside, 'outside.css'), 'utf8'), '.outside { color: blue; }\n', 'the file outside the root was overwritten');
    assert.equal(fs.existsSync(path.join(outcome.root, 'dist')), false, 'a dist/ folder was made for a refused target');
  } finally {
    gone(outcome);
  }
});
