import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import { listAt, mapAt, parseWorkflow } from './workflowYaml';

/**
 * `release-please-config.json` and `.release-please-manifest.json` against package.json (E3.S2). release-please
 * decides the next version from these two files and the commits, and a wrong bootstrap is silent: a manifest
 * naming a version that was never tagged makes release-please treat it as released and cut the one AFTER it
 * (measured in release-please 17's `Manifest.buildPullRequests`, see the config's `$bootstrap`), so 0.1.0
 * would never exist. Every list here is derived — the types from pr-title.yml, the releasing ones from
 * `docs-only-title.mjs` — never retyped.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const read = (file: string): unknown => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const MANIFEST = read('package.json') as { name: string; version: string; repository: { url: string } };

interface Section {
  readonly type: string;
  readonly section: string;
  readonly hidden?: boolean;
}

interface Config {
  readonly 'release-type'?: string;
  readonly 'include-component-in-tag'?: boolean;
  readonly 'include-v-in-tag'?: boolean;
  readonly 'initial-version'?: string;
  readonly 'tag-separator'?: string;
  readonly 'exclude-paths'?: readonly string[];
  readonly 'changelog-sections'?: readonly Section[];
  readonly draft?: boolean;
  readonly packages: Readonly<Record<string, Record<string, unknown>>>;
}

const config = (): Config => read('release-please-config.json') as Config;

/** The commit types the pull-request title check accepts — the family's conventional types here. */
function prTitleTypes(): string[] {
  const flow = mapAt(parseWorkflow(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pr-title.yml'), 'utf8')), 'pr-title.yml');
  const steps = listAt(mapAt(mapAt(flow['jobs'], 'jobs')['semantic'], 'semantic')['steps'], 'steps');
  const semantic = steps.map((step) => mapAt(step, 'step')).find((step) => String(step['uses']).startsWith('amannn/action-semantic-pull-request@'));
  const types = String(mapAt(semantic?.['with'], 'with')['types']);

  return types.split('\n').map((line) => line.trim()).filter(Boolean);
}

/** Whether docs-only-title.mjs treats `<type>: …` as a releasing title (it refuses one over README.md alone). */
function releasing(type: string): boolean {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-release-type-'));
  try {
    const facts = path.join(dir, 'facts.json');
    fs.writeFileSync(facts, JSON.stringify({ title: `${type}: a change`, files: ['README.md'], commits: [] }), 'utf8');
    const ran = spawnSync(process.execPath, [path.join(ROOT, '.github', 'scripts', 'docs-only-title.mjs'), '--facts', facts], { encoding: 'utf8', timeout: 30_000 });
    assert.ok(ran.status === 0 || ran.status === 1, `docs-only-title answered ${String(ran.status)}: ${ran.stderr}`);

    return ran.status === 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('one node package at the repository root, tagged v<version> with no component — the tag release.yml accepts', () => {
  const { packages, ...top } = config();

  assert.deepEqual(Object.keys(packages), ['.']);
  assert.deepEqual(packages['.'], {}, 'the root package takes the top-level settings, overriding none');
  assert.equal(top['release-type'], 'node');
  assert.equal(top['include-component-in-tag'], false);
  assert.notEqual(top['include-v-in-tag'], false);
  assert.equal(top['tag-separator'], undefined);
  assert.notEqual(top.draft, true, 'a draft raises no `release: published`, so release.yml would never run');
});

test('the manifest and package.json agree: before the first release the manifest is empty and initial-version is package.json\'s version; from the release pull request on, the manifest names package.json\'s version', () => {
  const manifest = read('.release-please-manifest.json') as Record<string, string>;
  const released = manifest['.'];

  assert.deepEqual(Object.keys(manifest).filter((key) => key !== '.'), [], 'the manifest names a package the config does not have');
  if (released === undefined || released === '0.0.0') {
    assert.equal(config()['initial-version'], MANIFEST.version,
      `nothing is released yet, so release-please cuts initial-version — it must be package.json's ${MANIFEST.version}`);
  } else {
    assert.equal(released, MANIFEST.version, 'the manifest and package.json name different versions');
  }
  assert.match(MANIFEST.version, /^\d+\.\d+\.\d+$/);
});

test('a manifest names a version only together with release-please\'s CHANGELOG.md section for it — the sibling bootstrap copied here would not', () => {
  // The bad bootstrap (a manifest saying 0.1.0 before anything is released) and the release pull request
  // (release-please writing 0.1.0 into the manifest just before it tags) carry the same two files. What only
  // release-please's own commit adds is the CHANGELOG.md section for that version — `## 0.1.0 (date)` for a
  // first release, `## [x.y.z](compare link) (date)` after — so that is what is asked for. Not git tags: a CI
  // checkout has none, and `git tag --list` then answers an empty list with exit 0.
  const released = (read('.release-please-manifest.json') as Record<string, string>)['.'];
  if (released === undefined || released === '0.0.0') {
    return;
  }
  const changelog = path.join(ROOT, 'CHANGELOG.md');
  const text = fs.existsSync(changelog) ? fs.readFileSync(changelog, 'utf8') : '';
  assert.match(text, new RegExp(`^## \\[?${released.replaceAll('.', '\\.')}\\]?[ (]`, 'm'),
    `the manifest says ${released} was released, but CHANGELOG.md has no section for it — release-please would cut the version after ${released}`);
});

test('the package release-please releases is the one package.json describes, from this repository', () => {
  assert.equal(MANIFEST.name, '@oleksandrdubyna88/vscode-webview-kit');
  assert.equal(MANIFEST.repository.url, 'https://github.com/oleksandrdubyna88/dew_flow_vscode_kit',
    'npm checks a provenance statement against repository.url — it must name the repository release.yml runs in');
});

test('a commit touching only .github is never a release, and exclude-paths holds directories only', () => {
  const excluded = config()['exclude-paths'] ?? [];

  assert.deepEqual(excluded, ['.github']);
  for (const entry of excluded) {
    assert.ok(fs.statSync(path.join(ROOT, entry)).isDirectory(), `${entry} is not a directory, so release-please matches nothing with it`);
  }
});

test('every type the title check accepts has a changelog section, and a section is visible exactly when docs-only-title calls its type releasing', () => {
  const sections = config()['changelog-sections'] ?? [];
  const types = prTitleTypes();

  assert.ok(types.length >= 9, `pr-title.yml lists ${types.join(', ')}`);
  const missing = types.filter((type) => !sections.some((section) => section.type === type));
  assert.deepEqual(missing, [], 'a title type with no changelog section');
  for (const section of sections) {
    assert.equal(section.hidden !== true, releasing(section.type),
      `"${section.type}" is ${section.hidden === true ? 'hidden' : 'visible'} in the changelog, but docs-only-title says it ${releasing(section.type) ? 'releases' : 'does not release'} — a visible section is what opens a release`);
  }
  assert.ok(sections.some((section) => section.hidden !== true), 'no visible section at all: nothing would ever release');
});
