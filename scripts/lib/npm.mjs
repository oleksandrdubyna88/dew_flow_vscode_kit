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

/** The only registry the job's package-write token may be sent to; `publishConfig.registry` must be exactly this. */
export const GITHUB_PACKAGES = 'https://npm.pkg.github.com';
/** npm's key for that registry's credentials: `//<host>/`, no scheme, one trailing slash. */
const CREDENTIAL_KEY = `//${new URL(GITHUB_PACKAGES).host}/`;

/**
 * `{ owner, repo, url }` of a package.json `repository` (a string or `{ url }`): `https://github.com/<owner>/<repo>`
 * in any of its spellings — a `git+` prefix, `github:<owner>/<repo>`, a `.git` suffix, trailing slashes. The ONE
 * parser of it here: `verify-published.mjs` derives its owner and repository from it too. Throws for any other shape.
 */
export function repositoryOwnerAndName(repository) {
  const raw = typeof repository === 'string' ? repository : repository?.url ?? '';
  const url = `${raw}`.replace(/^git\+/, '').replace(/^github:/, 'https://github.com/').replace(/\/+$/, '').replace(/\.git$/, '').replace(/\/+$/, '');
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(url);
  if (match === null) {
    throw new Error(`repository.url is not https://github.com/<owner>/<repo>: ${url}`);
  }

  return { owner: match[1], repo: match[2], url };
}

/** The package's scope (`@owner`), which is what npm maps to a registry: it must be `@` + the repository's owner. */
function scopeOf(manifest) {
  const scope = `${manifest.name}`.split('/')[0];
  if (!scope.startsWith('@') || !`${manifest.name}`.includes('/')) {
    throw new Error(`package name "${manifest.name}" has no @scope, so no registry can be mapped to it`);
  }
  const { owner } = repositoryOwnerAndName(manifest.repository);
  if (scope !== `@${owner}`) {
    throw new Error(`package scope ${scope} is not @${owner}, the owner of the repository in package.json — GitHub Packages takes no other scope`);
  }

  return scope;
}

/** `GITHUB_PACKAGES`, when `publishConfig.registry` is exactly that (one trailing slash tolerated); throws otherwise. */
function registryOf(manifest) {
  const seen = manifest.publishConfig?.registry;
  if (typeof seen !== 'string' || seen.replace(/\/$/, '') !== GITHUB_PACKAGES) {
    throw new Error(`publishConfig.registry is ${JSON.stringify(seen)}, not ${JSON.stringify(GITHUB_PACKAGES)} — the only registry the job's token may be sent to`);
  }

  return GITHUB_PACKAGES;
}

/**
 * An environment in which npm talks to GitHub Packages as the package's own scope maps it: no `npm_*`
 * variables from the parent, and a user config — a file in `dir`, so a developer's own `~/.npmrc` (a login, a
 * mirror) cannot change what is asked — holding two lines derived from `manifest` (package.json), never
 * retyped: `<scope>:registry=<registry>` and the registry's `_authToken` as the LITERAL text
 * `${NODE_AUTH_TOKEN}`. npm expands that from its own environment, so the token is never written to disk;
 * it stays in the returned environment, where npm reads it.
 *
 * The registry is PINNED: `publishConfig.registry` must be exactly `GITHUB_PACKAGES` (one trailing slash
 * tolerated), and the scope must be `@` + the owner of `manifest.repository` — so a typo or a changed manifest
 * can never send the job's package-write token to another host or publish under another owner.
 *
 * Throws, before anything is written, when `NODE_AUTH_TOKEN` is unset or empty (checked FIRST: GitHub Packages
 * serves nothing without a token, and a run that cannot have one should stop and say what to set), or when the
 * registry or the scope is not the pinned one.
 */
export function registryEnv(dir, manifest) {
  if ((process.env.NODE_AUTH_TOKEN ?? '') === '') {
    throw new Error(EMPTY_TOKEN);
  }
  const registry = registryOf(manifest);
  const userconfig = join(dir, 'registry.npmrc');
  const scope = scopeOf(manifest);
  writeFileSync(userconfig, `${scope}:registry=${registry}\n${CREDENTIAL_KEY}:_authToken=\${NODE_AUTH_TOKEN}\n`);

  return { ...childEnv(), npm_config_userconfig: userconfig };
}
