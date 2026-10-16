/**
 * How this repository's scripts start npm — one place, shared by `pack-and-consume.mjs`,
 * `verify-published.mjs` and `publish-once.mjs` (extracted from the first when the second needed the same
 * two things).
 *
 * npm is started as `node <npm-cli.js> <args>`: exe + argv, no shell, no `.cmd` shim, on every OS. Its own
 * `npm_*` variables are removed from every child's environment, so a script started by `npm test` or
 * `npm publish` cannot hand that npm's prefix, dry-run or user config to the npm it starts.
 *
 * Every npm a script starts talks to GitHub Packages (`registryEnv`): the registry and the scope come from
 * package.json, and the token is only ever a `${NODE_AUTH_TOKEN}` reference in the user config npm reads —
 * the value stays in the environment and is never written to disk.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** npm's own CLI script: the one the calling npm ran, else the one installed beside this node; throws if neither. */
export function npmCli() {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const found = candidates.find((candidate) => candidate !== undefined && candidate.endsWith('npm-cli.js') && existsSync(candidate));
  if (found === undefined) {
    throw new Error(`cannot find npm-cli.js beside ${process.execPath}; looked at: ${candidates.filter(Boolean).join(', ')}`);
  }

  return found;
}

/** This environment without npm's `npm_*` variables (keys compared case-insensitively, as Windows does). */
export function childEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_/i.test(key)));
}

const EMPTY_TOKEN = 'NODE_AUTH_TOKEN is empty — in CI give the job a GITHUB_TOKEN with packages: read (NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}); locally set it to a personal access token (classic) with read:packages';

/** The package's scope (`@owner`), which is what npm maps to a registry; throws for an unscoped name. */
function scopeOf(manifest) {
  const scope = `${manifest.name}`.split('/')[0];
  if (!scope.startsWith('@') || !`${manifest.name}`.includes('/')) {
    throw new Error(`package name "${manifest.name}" has no @scope, so no registry can be mapped to it`);
  }

  return scope;
}

/** The registry URL package.json's `publishConfig` names, which must be https; throws otherwise. */
function registryOf(manifest) {
  const registry = manifest.publishConfig?.registry;
  if (typeof registry !== 'string' || !URL.canParse(registry) || new URL(registry).protocol !== 'https:') {
    throw new Error(`publishConfig.registry is not an https URL: ${JSON.stringify(registry)}`);
  }

  return registry;
}

/** npm's key for a registry's credentials: `//<host><path>/`, with no scheme and exactly one trailing slash. */
function credentialKey(registry) {
  const { host, pathname } = new URL(registry);

  return `//${host}${pathname.replace(/\/+$/, '')}/`;
}

/**
 * An environment in which npm talks to GitHub Packages as the package's own scope maps it: no `npm_*`
 * variables from the parent, and a user config — a file in `dir`, so a developer's own `~/.npmrc` (a login, a
 * mirror) cannot change what is asked — holding two lines derived from `manifest` (package.json), never
 * retyped: `<scope>:registry=<publishConfig.registry>` and the registry's `_authToken` as the LITERAL text
 * `${NODE_AUTH_TOKEN}`. npm expands that from its own environment, so the token is never written to disk;
 * it stays in the returned environment, where npm reads it.
 *
 * Throws, before anything is written, when `NODE_AUTH_TOKEN` is unset or empty: GitHub Packages serves nothing
 * without a token, and a run that cannot have one should stop and say what to set.
 */
export function registryEnv(dir, manifest) {
  if ((process.env.NODE_AUTH_TOKEN ?? '') === '') {
    throw new Error(EMPTY_TOKEN);
  }
  const registry = registryOf(manifest);
  const userconfig = join(dir, 'registry.npmrc');
  writeFileSync(userconfig, `${scopeOf(manifest)}:registry=${registry}\n${credentialKey(registry)}:_authToken=\${NODE_AUTH_TOKEN}\n`);

  return { ...childEnv(), npm_config_userconfig: userconfig };
}
