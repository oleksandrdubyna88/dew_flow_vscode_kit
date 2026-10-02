/**
 * How this repository's scripts start npm — one place, shared by `pack-and-consume.mjs` and
 * `verify-published.mjs` (extracted from the first when the second needed the same two things).
 *
 * npm is started as `node <npm-cli.js> <args>`: exe + argv, no shell, no `.cmd` shim, on every OS. Its own
 * `npm_*` variables are removed from every child's environment, so a script started by `npm test` or
 * `npm publish` cannot hand that npm's prefix, dry-run or user config to the npm it starts.
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

/**
 * An environment in which npm asks the registry as ANYBODY would: no `npm_*` variables, no
 * `NODE_AUTH_TOKEN`, and a user config that is an empty file in `dir` — so neither a token a release job
 * holds nor a developer's own `~/.npmrc` (a login, a mirror) can change what the registry answers.
 */
export function anonymousEnv(dir) {
  const userconfig = join(dir, 'anonymous.npmrc');
  writeFileSync(userconfig, '');
  const env = Object.fromEntries(Object.entries(childEnv()).filter(([key]) => !/^node_auth_token$/i.test(key)));

  return { ...env, npm_config_userconfig: userconfig };
}
