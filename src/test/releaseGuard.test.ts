import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

/**
 * `.github/scripts/release-guard.mjs` — the first step of both of release.yml's own jobs: whether this run
 * may publish. Run as the workflow runs it, over facts in a file (`--facts`), so every refusal is seen here
 * on every pull request rather than first on a release (common.testing, "a check that only runs during a
 * release has never run"). The package name and version in the facts are read from package.json, never
 * retyped, so a version bump cannot leave these tests asserting last release's number.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, '.github', 'scripts', 'release-guard.mjs');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { name: string; version: string };
const SHA = 'c0ffee'.padEnd(40, '0');

/** What release.yml sees for the release release-please cuts for this package.json. */
const good = (): Record<string, unknown> => ({
  eventName: 'release',
  ref: `refs/tags/v${MANIFEST.version}`,
  sha: SHA,
  tag: `v${MANIFEST.version}`,
  draft: 'false',
  prerelease: 'false',
  authorType: 'Bot',
  head: SHA,
  onMain: true,
  packageName: MANIFEST.name,
  packageVersion: MANIFEST.version,
});

function guard(facts: unknown): { code: number | null; said: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-guard-'));
  try {
    const file = path.join(dir, 'facts.json');
    const output = path.join(dir, 'github-output');
    fs.writeFileSync(file, JSON.stringify(facts), 'utf8');
    // GITHUB_OUTPUT points somewhere real, so a guard that wrote it in --facts mode would be seen doing so.
    const ran = spawnSync(process.execPath, [SCRIPT, '--facts', file], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, GITHUB_OUTPUT: output } });
    assert.equal(ran.error, undefined, `could not run: ${String(ran.error)}`);
    assert.equal(fs.existsSync(output), false, '--facts mode must never write the job\'s outputs');

    return { code: ran.status, said: `${ran.stdout}${ran.stderr}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('the release release-please cuts from main for this package.json may publish', () => {
  const { code, said } = guard(good());

  assert.equal(code, 0, said);
  assert.equal(said, `release-guard: ok — ${MANIFEST.name}@${MANIFEST.version}\n`);
});

test('each way a run is not that release is refused, with its own reason', () => {
  const refusals: readonly (readonly [string, Record<string, unknown>, RegExp])[] = [
    ['a pull request', { eventName: 'pull_request' }, /started by "pull_request", not by a published release/],
    ['a component-prefixed tag', { tag: `vscode-webview-kit-v${MANIFEST.version}`, ref: `refs/tags/vscode-webview-kit-v${MANIFEST.version}` }, /is not v<major>\.<minor>\.<patch>/],
    ['a pre-release tag', { tag: `v${MANIFEST.version}-rc.1`, ref: `refs/tags/v${MANIFEST.version}-rc.1` }, /is not v<major>\.<minor>\.<patch>/],
    ['a tag without v', { tag: MANIFEST.version, ref: `refs/tags/${MANIFEST.version}` }, /is not v<major>\.<minor>\.<patch>/],
    ['a run on a branch', { ref: 'refs/heads/main' }, /the run's ref "refs\/heads\/main" is not refs\/tags\/v/],
    ['a draft', { draft: 'true' }, /the release is a draft/],
    ['a pre-release', { prerelease: 'true' }, /the release is a pre-release/],
    ['a release a person made by hand', { authorType: 'User' }, /made by a "User", not by the release App/],
    ['a checkout of another commit', { head: 'f'.repeat(40) }, /the checkout is at f+, not at the release's commit/],
    ['a commit that is not on main', { onMain: false }, /is not on main/],
    ['a package.json that disagrees with the tag', { packageVersion: '9.9.9' }, new RegExp(`package\\.json says .*@9\\.9\\.9, the tag says ${MANIFEST.version.replaceAll('.', '\\.')}`)],
  ];
  for (const [what, change, why] of refusals) {
    const { code, said } = guard({ ...good(), ...change });
    assert.equal(code, 1, `${what} was not refused: ${said}`);
    assert.match(said, why, what);
    assert.match(said, /^release-guard: this run may not publish\.$/m, what);
  }
});

test('every refusal is listed, not only the first', () => {
  const { code, said } = guard({ ...good(), draft: 'true', authorType: 'User', onMain: false });

  assert.equal(code, 1);
  assert.equal(said.split('\n').filter((line) => line.startsWith('  - ')).length, 3, said);
});

test('facts it cannot read are refused with exit 2, not passed', () => {
  const missing: Record<string, unknown> = { ...good() };
  delete missing['onMain'];

  assert.equal(guard(missing).code, 2);
  assert.equal(guard({ ...good(), draft: false }).code, 2, 'a boolean where the event hands over text is a malformed fact');
});
