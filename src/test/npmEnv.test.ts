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

const REAL: Manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
/** Another scope/owner pair that is consistent with itself, and the registry spelled with its one trailing slash. */
const OTHER: Manifest = { name: '@acme/widget', repository: { url: 'git+https://github.com/acme/widget-repo.git' }, publishConfig: { registry: 'https://npm.pkg.github.com/' } };

interface Manifest {
  readonly name: string;
  readonly repository: { readonly url: string };
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

  const answer: Answer = JSON.parse(ran.stdout);

  return answer;
}

/** `repositoryOwnerAndName(repository)` for each input, in a child: its answer, or the message it threw. */
function parse(inputs: readonly unknown[]): readonly unknown[] {
  const code = [
    'const { repositoryOwnerAndName } = await import(process.env.KIT_LIB);',
    'const answers = JSON.parse(process.env.KIT_CASE).map((input) => {',
    '  try { return repositoryOwnerAndName(input); } catch (error) { return { threw: error.message }; }',
    '});',
    'process.stdout.write(JSON.stringify(answers));',
  ].join('\n');
  const ran = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 30_000, env: { ...cleanEnv({}), KIT_LIB: LIB, KIT_CASE: JSON.stringify(inputs) } });
  assert.equal(ran.error, undefined, `could not run: ${String(ran.error)}`);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  const answers: unknown[] = JSON.parse(ran.stdout);

  return answers;
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
      `@acme:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=${REFERENCE}\n`);
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

test('registryEnv refuses any registry but https://npm.pkg.github.com — the job\'s package-write token can never be sent to another host — and writes no file', () => {
  for (const registry of ['https://registry.example.test/npm/', 'https://registry.npmjs.org', 'http://npm.pkg.github.com', 'https://npm.pkg.github.com//', 'https://npm.pkg.github.com/x', '']) {
    inTemp((dir) => {
      const answer = ask(dir, { ...REAL, publishConfig: { registry } }, cleanEnv({ NODE_AUTH_TOKEN: SENTINEL }));

      assert.equal(answer.ok, false, `registry "${registry}" was accepted`);
      assert.ok(answer.message.includes(`"${registry}"`), `the message does not name the value seen: ${answer.message}`);
      assert.ok(answer.message.includes('https://npm.pkg.github.com'), `the message does not name the only accepted registry: ${answer.message}`);
      assert.deepEqual(fs.readdirSync(dir), [], 'a file was written before the registry was checked');
    });
  }
});

test('registryEnv accepts https://npm.pkg.github.com with ONE trailing slash and writes it without one', () => {
  inTemp((dir) => {
    const answer = ask(dir, { ...REAL, publishConfig: { registry: 'https://npm.pkg.github.com/' } }, cleanEnv({ NODE_AUTH_TOKEN: SENTINEL }));

    assert.equal(answer.ok, true, answer.message);
    assert.ok(fs.readFileSync(answer.userconfig, 'utf8').startsWith(`${REAL.name.split('/')[0]}:registry=https://npm.pkg.github.com\n`));
  });
});

test('registryEnv refuses a scope that is not the repository owner, naming both, and writes no file', () => {
  inTemp((dir) => {
    const answer = ask(dir, { ...REAL, name: '@someone-else/vscode-webview-kit' }, cleanEnv({ NODE_AUTH_TOKEN: SENTINEL }));

    assert.equal(answer.ok, false, 'a scope of another owner was accepted');
    assert.ok(answer.message.includes('@someone-else'), answer.message);
    assert.ok(answer.message.includes(`@${REAL.name.slice(1).split('/')[0]}`), answer.message);
    assert.deepEqual(fs.readdirSync(dir), [], 'a file was written before the scope was checked');
  });
});

test('registryEnv checks the token FIRST: an empty token with a wrong registry is still the token message', () => {
  inTemp((dir) => {
    const answer = ask(dir, { ...REAL, publishConfig: { registry: 'https://registry.example.test/' } }, cleanEnv({ NODE_AUTH_TOKEN: '' }));

    assert.equal(answer.ok, false);
    assert.match(answer.message, /^NODE_AUTH_TOKEN is empty/);
  });
});

test('repositoryOwnerAndName reads every spelling of a GitHub repository — git+ prefix, .git suffix, github: shorthand, trailing slashes, a string or an object — and refuses the rest', () => {
  const same = { owner: 'o', repo: 'r', url: 'https://github.com/o/r' };
  const answers = parse([
    'https://github.com/o/r',
    { type: 'git', url: 'git+https://github.com/o/r.git' },
    'github:o/r',
    'https://github.com/o/r/',
    'https://github.com/o/r.git/',
    'https://example.test/o/r',
    'https://github.com/o',
    undefined,
  ]);

  assert.deepEqual(answers.slice(0, 5), [same, same, same, same, same]);
  for (const refused of answers.slice(5)) {
    assert.match(String((refused as { threw?: string }).threw), /repository\.url is not https:\/\/github\.com\/<owner>\/<repo>/);
  }
});