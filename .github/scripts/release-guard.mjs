#!/usr/bin/env node
// release-guard.mjs — whether THIS run may publish: the release release-please cut, at the commit it
// tagged on main, with package.json saying the version the tag says.
//
//   node .github/scripts/release-guard.mjs                  (in release.yml: the facts come from the event and git)
//   node .github/scripts/release-guard.mjs --facts <file>   (the same facts, as JSON — the suite's way in)
//
// Exit 0  every check passed; prints `release-guard: ok — <name>@<version>` and, in a workflow, writes
//         `version=<version>` to $GITHUB_OUTPUT (never in --facts mode).
// Exit 1  a check refused; every refusal is printed, not only the first.
// Exit 2  the facts could not be gathered or read. A guard that cannot look must not pass.
//
// The event's values arrive as environment variables set by the workflow (RELEASE_TAG, RELEASE_DRAFT,
// RELEASE_PRERELEASE, RELEASE_AUTHOR_TYPE) beside GitHub's own (GITHUB_EVENT_NAME, GITHUB_REF,
// GITHUB_SHA); nothing from the event is ever pasted into a shell. git runs as exe + argv under a timeout.
//
// WHY EACH CHECK (todo/PLAN_extract_the_kit.md, epic 3 plan round, finding 6; §6):
//   event      the trigger is `release: published` alone; a second trigger added later still meets this.
//   tag        exactly `v<major>.<minor>.<patch>` — release-please's component-less tag. A prefixed tag, a
//              pre-release suffix or a hand-made `v1` is not a release of this package.
//   ref        the run's ref IS that tag, so the checkout is the tagged commit and nothing else.
//   draft      a draft or pre-release is not what release-please cuts here (release-please-config.json).
//   author     the release was made by a bot — the release App, the only bot that can raise this event
//              (a release made with GITHUB_TOKEN starts no workflow). A person's hand-made release is refused.
//   head       the commit checked out is the release's commit (GITHUB_SHA).
//   main       that commit is on main: release-please cuts from main, and a tag on a side branch is not.
//   version    package.json at the tag says the tag's version, so what is published is what is tagged.

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG_SHAPE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const GIT_TIMEOUT_MS = 30_000;

/** Every refusal the facts earn, in a fixed order; empty when the run may publish. */
export function refusals(facts) {
  const version = facts.tag.slice(1);
  const checks = [
    [facts.eventName === 'release', `the run was started by "${facts.eventName}", not by a published release`],
    [TAG_SHAPE.test(facts.tag), `the tag "${facts.tag}" is not v<major>.<minor>.<patch>`],
    [facts.ref === `refs/tags/${facts.tag}`, `the run's ref "${facts.ref}" is not refs/tags/${facts.tag}`],
    [facts.draft !== 'true', 'the release is a draft'],
    [facts.prerelease !== 'true', 'the release is a pre-release'],
    [facts.authorType === 'Bot', `the release was made by a "${facts.authorType}", not by the release App`],
    [facts.head === facts.sha, `the checkout is at ${facts.head}, not at the release's commit ${facts.sha}`],
    [facts.onMain === true, `the release's commit ${facts.sha} is not on main`],
    [facts.packageVersion === version, `package.json says ${facts.packageName}@${facts.packageVersion}, the tag says ${version}`],
  ];

  return checks.filter(([ok]) => !ok).map(([, why]) => why);
}

const FACT_KEYS = ['eventName', 'ref', 'sha', 'tag', 'draft', 'prerelease', 'authorType', 'head', 'packageName', 'packageVersion'];

/** Whether `value` carries every fact as a string, and `onMain` as a boolean. */
export function isFacts(value) {
  return value !== null && typeof value === 'object'
    && FACT_KEYS.every((key) => typeof value[key] === 'string')
    && typeof value.onMain === 'boolean';
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, killSignal: 'SIGKILL' });
  if (result.error !== undefined) {
    throw new Error(`git ${args.join(' ')} did not run: ${result.error.message}`);
  }

  return result;
}

/** Whether HEAD is an ancestor of (or equal to) origin/main; anything but git's yes/no is an error. */
function onMain(root) {
  const result = git(['merge-base', '--is-ancestor', 'HEAD', 'refs/remotes/origin/main'], root);
  if (result.status === 0 || result.status === 1) {
    return result.status === 0;
  }
  throw new Error(`git could not compare HEAD with origin/main (exit ${result.status}) — does the checkout have main? ${result.stderr.trim()}`);
}

/** The live facts: the event's environment, git, and package.json at the checkout. */
function gather(root) {
  const env = process.env;
  const head = git(['rev-parse', 'HEAD'], root);
  if (head.status !== 0) {
    throw new Error(`git rev-parse HEAD failed: ${head.stderr.trim()}`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  return {
    eventName: env.GITHUB_EVENT_NAME ?? '', ref: env.GITHUB_REF ?? '', sha: env.GITHUB_SHA ?? '',
    tag: env.RELEASE_TAG ?? '', draft: env.RELEASE_DRAFT ?? '', prerelease: env.RELEASE_PRERELEASE ?? '',
    authorType: env.RELEASE_AUTHOR_TYPE ?? '', head: head.stdout.trim(), onMain: onMain(root),
    packageName: String(manifest.name), packageVersion: String(manifest.version),
  };
}

function readFacts(argv, root) {
  const at = argv.indexOf('--facts');
  if (at < 0) {
    return { facts: gather(root), live: true };
  }
  const file = argv[at + 1];
  if (file === undefined) {
    throw new Error('--facts needs a file');
  }

  return { facts: JSON.parse(fs.readFileSync(file, 'utf8')), live: false };
}

function main(argv) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  let read;
  try {
    read = readFacts(argv, root);
  } catch (error) {
    console.error(`release-guard: could not read what to check: ${error.message}`);
    return 2;
  }
  if (!isFacts(read.facts)) {
    console.error(`release-guard: the facts need ${FACT_KEYS.join(', ')} as strings and onMain as a boolean.`);
    return 2;
  }
  const refused = refusals(read.facts);
  if (refused.length > 0) {
    console.error(['release-guard: this run may not publish.', ...refused.map((why) => `  - ${why}`)].join('\n'));
    return 1;
  }
  const version = read.facts.tag.slice(1);
  if (read.live && process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  }
  console.log(`release-guard: ok — ${read.facts.packageName}@${version}`);

  return 0;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  process.exitCode = main(process.argv.slice(2));
}
