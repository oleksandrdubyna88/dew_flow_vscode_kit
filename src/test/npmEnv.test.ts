import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

/**
 * `registryEnv` in `scripts/lib/npm.mjs` — the environment every npm this repository's scripts start runs in
 * (`publish-once.mjs`, `verify-published.mjs`, `pack-and-consume.mjs --published`): GitHub Packages as the
 * registry for this package's scope, a token npm READS from the environment and the scripts never write to
 * disk, and no `npm_*` variable from the parent.
 *
 * The library is an ES module outside the TypeScript program, so each case runs it in a tiny
 * `node --input-type=module` child with an EXPLICIT environment — which is also what keeps the parent's own
 * `NODE_AUTH_TOKEN` (a CI job has one) out of every scenario.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const LIB = pathToFileURL(path.join(ROOT, 'scripts', 'lib', 'npm.mjs')).href;
const SENTINEL = 'sentinel-never-written';
/** The literal text npm expands from its own environment — not a template of this file. */
const REFERENCE = '${NODE_AUTH_TOKEN}';

const REAL = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as Manifest;
const OTHER: Manifest = { name: '@acme/widget', publishConfig: { registry: 'https://registry.example.test:8443/npm/' } };

interface Manifest {
  readonly name: string;
  readonly publishConfig: { readonly registry: string };
}

interface Answer {
  readonly ok: boolean;
  readonly message: string;
  readonly userconfig: string;
  readonly npmKeys: readonly string[];
  readonly hasToken: boolean;
}

/** Runs `registryEnv(dir, manifest)` in a child whose whole environment is `env`; what it answered, as data. */
function ask(dir: string, manifest: Manifest, env: NodeJS.ProcessEnv): Answer {
  const code = [
    'const { registryEnv } = await import(process.env.KIT_LIB);',
    'const { dir, manifest } = JSON.parse(process.env.KIT_CASE);',
    'try {',
    '  const env = registryEnv(dir, manifest);',
    '  const npmKeys = Object.keys(env).filter((key) => /^npm_/i.test(key));',
    "  process.stdout.write(JSON.stringify({ ok: true, message: '', userconfig: env.npm_config_userconfig ?? '', npmKeys, hasToken: typeof env.NODE_AUTH_TOKEN === 'string' && env.NODE_AUTH_TOKEN !== '' }));",
    '} catch (error) {',
    "  process.stdout.write(JSON.stringify({ ok: false, message: error.message, userconfig: '', npmKeys: [], hasToken: false }));",
    '}',
  ].join('\n');
  const ran = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...env, KIT_LIB: LIB, KIT_CASE: JSON.stringify({ dir, manifest }) },
  });
  assert.equal(ran.error, undefined, `could not run: ${String(ran.error)}`);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);

  return JSON.parse(ran.stdout) as Answer;
}

/** The parent environment without any token or `npm_*` variable, plus `extra` — nothing leaks in from CI. */
function cleanEnv(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const kept = Object.entries(process.env).filter(([key]) => !/^npm_/i.test(key) && !/^node_auth_token$/i.test(key));

  return { ...Object.fromEntries(kept), ...extra };
}

function inTemp<T>(body: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-npm-env-'));
  try {
    return body(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('registryEnv writes exactly two lines — the scope registry and the token REFERENCE — derived from the manifest it is given', () => {
  inTemp((dir) => {
    const answer = ask(dir, OTHER, cleanEnv({ NODE_AUTH_TOKEN: SENTINEL }));

    assert.equal(answer.ok, true, answer.message);
    assert.equal(answer.userconfig, path.join(dir, 'registry.npmrc'));
    assert.equal(fs.readFileSync(answer.userconfig, 'utf8'),
      `@acme:registry=https://registry.example.test:8443/npm/\n//registry.example.test:8443/npm/:_authToken=${REFERENCE}\n`);
    assert.equal(answer.hasToken, true, 'the token must stay in the environment, where npm reads it');
  });
});

test('registryEnv over this package.json names the GitHub Packages registry for this package\'s own scope', () => {
  inTemp((dir) => {
    const answer = ask(dir, REAL, cleanEnv({ NODE_AUTH_TOKEN: SENTINEL }));

    assert.equal(answer.ok, true, answer.message);
    assert.equal(fs.readFileSync(answer.userconfig, 'utf8'),
      `${REAL.name.split('/')[0]}:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=${REFERENCE}\n`);
  });
});

test('registryEnv never writes the token VALUE to disk — only the ${NODE_AUTH_TOKEN} reference npm expands itself', () => {
  inTemp((dir) => {
    const answer = ask(dir, REAL, cleanEnv({ NODE_AUTH_TOKEN: SENTINEL }));
    assert.equal(answer.ok, true, answer.message);
    const written = fs.readFileSync(answer.userconfig, 'utf8');

    assert.ok(!written.includes(SENTINEL), `the user config holds the token value:\n${written}`);
    assert.ok(written.includes(REFERENCE), `the user config holds no ${REFERENCE} reference:\n${written}`);
    assert.deepEqual(fs.readdirSync(dir), ['registry.npmrc'], 'nothing but the one config file may be written');
  });
});

test('registryEnv drops npm_* of any case from the parent — only its own lower-case npm_config_userconfig survives', () => {
  inTemp((dir) => {
    const answer = ask(dir, REAL, cleanEnv({ NODE_AUTH_TOKEN: SENTINEL, NPM_CONFIG_USERCONFIG: 'x', npm_config_foo: 'y', Npm_Config_Bar: 'z' }));

    assert.equal(answer.ok, true, answer.message);
    assert.deepEqual(answer.npmKeys, ['npm_config_userconfig']);
    assert.equal(answer.userconfig, path.join(dir, 'registry.npmrc'), 'the parent\'s NPM_CONFIG_USERCONFIG won over the script\'s own file');
  });
});

test('registryEnv refuses an empty or unset NODE_AUTH_TOKEN, naming both token kinds, and writes no file', () => {
  for (const env of [cleanEnv({ NODE_AUTH_TOKEN: '' }), cleanEnv({})]) {
    inTemp((dir) => {
      const answer = ask(dir, REAL, env);

      assert.equal(answer.ok, false, 'an empty token must not be accepted');
      assert.match(answer.message, /^NODE_AUTH_TOKEN is empty/);
      assert.match(answer.message, /packages: read/);
      assert.match(answer.message, /read:packages/);
      assert.deepEqual(fs.readdirSync(dir), [], 'a file was written before the token was checked');
    });
  }
});
