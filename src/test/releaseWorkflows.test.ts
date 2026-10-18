import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

import { listAt, mapAt, parseWorkflow, type Yaml } from './workflowYaml';

/**
 * The release path's SHAPE, held in the ordinary suite (E3.S2; epic 3 plan round, findings 0, 3, 6). The
 * one run that exercises `release.yml` for real is a release, and "a check that only runs during a
 * release has never run" (common.testing) — so what can be read off the files is read here, on every
 * pull request: who may publish, what it waits for, which secret it sees and where, and that nothing a
 * pull request starts can reach any of it.
 *
 * Read through `workflowYaml.ts`, which refuses YAML outside its subset rather than half-reading it.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');
const PACK_AND_CONSUME = './.github/workflows/pack-and-consume.yml';
const PULL_REQUEST_TRIGGERS = ['pull_request', 'pull_request_target', 'pull_request_review', 'pull_request_review_comment', 'issue_comment', 'workflow_run'];

type Map = { readonly [key: string]: Yaml };

const workflow = (file: string): Map => mapAt(parseWorkflow(fs.readFileSync(path.join(WORKFLOWS, file), 'utf8')), file);
const jobsOf = (flow: Map, file: string): Map => mapAt(flow['jobs'], `${file} jobs`);
const stepsOf = (job: Map, what: string): Map[] => listAt(job['steps'], `${what} steps`).map((step, i) => mapAt(step, `${what} step ${i}`));
const allWorkflows = (): string[] => fs.readdirSync(WORKFLOWS).filter((file) => file.endsWith('.yml')).sort();

/** Every [path, value] pair under `node`, paths spelled `a.b.0.c`. */
function walk(node: Yaml, at: string): [string, Yaml][] {
  if (node === null || typeof node === 'string') {
    return [[at, node]];
  }
  const entries: [string, Yaml][] = Array.isArray(node)
    ? (node as readonly Yaml[]).map((child, i): [string, Yaml] => [`${at}.${i}`, child])
    : Object.entries(node as Map).map(([key, child]): [string, Yaml] => [`${at}.${key}`, child]);

  return [[at, node], ...entries.flatMap(([childAt, child]) => walk(child, childAt))];
}

/** The paths of every string value containing `needle`. */
const stringsWith = (node: Yaml, root: string, needle: string): string[] =>
  walk(node, root).filter(([, value]) => typeof value === 'string' && value.includes(needle)).map(([at]) => at);

/** The paths of every mapping key named `key`. */
const keysNamed = (node: Yaml, root: string, key: string): string[] =>
  walk(node, root).filter(([at]) => at.endsWith(`.${key}`)).map(([at]) => at);

const triggersOf = (flow: Map, file: string): string[] => Object.keys(mapAt(flow['on'], `${file} on`));

/** The job whose `uses:` is the reusable pack-and-consume workflow. */
function packAndConsumeCall(jobs: Map): string {
  const calls = Object.entries(jobs).filter(([, job]) => mapAt(job, 'job')['uses'] === PACK_AND_CONSUME).map(([id]) => id);
  assert.equal(calls.length, 1, `release.yml must call ${PACK_AND_CONSUME} exactly once; calls: ${calls.join(', ')}`);

  return calls[0] as string;
}

/** The one step whose `run` is the publish command — `publish-once.mjs`, which is the only thing that runs `npm publish`. */
function publishStep(steps: readonly Map[]): Map {
  const found = steps.filter((step) => typeof step['run'] === 'string' && /publish-once\.mjs/.test(step['run']));
  assert.equal(found.length, 1, `the publish job must have exactly one publish-once step, found ${found.length}`);

  return found[0] as Map;
}

const jobOf = (flow: Map, id: string): Map => mapAt(jobsOf(flow, 'release.yml')[id], `release.yml job "${id}"`);
const stepsOfJob = (flow: Map, id: string): Map[] => stepsOf(jobOf(flow, id), id);
const publishSteps = (flow: Map): Map[] => stepsOfJob(flow, 'publish');
const publishJob = (flow: Map): Map => jobOf(flow, 'publish');
const runs = (pattern: RegExp) => (step: Map): boolean => typeof step['run'] === 'string' && pattern.test(step['run']);
const usesAction = (action: string) => (step: Map): boolean => String(step['uses']).startsWith(`${action}@`);
const TARBALL_PATH = '${{ steps.tarball.outputs.path }}';
const JOB_TOKEN = '${{ secrets.GITHUB_TOKEN }}';
const PRIVILEGED_PERMISSIONS = ['packages', 'id-token', 'attestations'];
const PRIVILEGED_ACTIONS = ['actions/checkout', 'actions/setup-node', 'actions/download-artifact', 'actions/attest-build-provenance'];

/** The index of the step satisfying `found` in `steps`, or a failure naming what is missing. */
function indexOfStep(steps: readonly Map[], what: string, found: (step: Map) => boolean): number {
  const at = steps.findIndex(found);
  assert.ok(at >= 0, `there is no step that ${what}`);

  return at;
}

/** Every `[jobId, step]` of `release.yml` that has steps (a job that calls a reusable workflow has none). */
function releaseSteps(flow: Map): [string, Map][] {
  return Object.entries(jobsOf(flow, 'release.yml'))
    .filter(([id, job]) => mapAt(job, id)['steps'] !== undefined)
    .flatMap(([id]) => stepsOfJob(flow, id).map((step): [string, Map] => [id, step]));
}

/** Whether a job grants `packages`, `id-token` or `attestations` at `write` — the credentials the publish needs. */
function isPrivileged(job: Map): boolean {
  const permissions = job['permissions'];
  if (permissions === undefined || permissions === null || typeof permissions === 'string' || Array.isArray(permissions)) {
    return false;
  }

  return PRIVILEGED_PERMISSIONS.some((key) => (permissions as Map)[key] === 'write');
}

/**
 * The three shapes a `run:` in a privileged job may take: the tarball check, the publish script, the verify
 * script. The check must not name a package manager — `sha256sum -c` needs none, and a line after it that
 * installs would run dependency code beside the credentials.
 */
const PRIVILEGED_RUN_SHAPES: readonly ((run: string) => boolean)[] = [
  (run) => run.startsWith('set -euo pipefail') && run.includes('sha256sum -c "$TARBALL.sha256"') && !/\b(npm|npx|yarn|pnpm)\b/.test(run),
  (run) => run === 'node scripts/publish-once.mjs "$TARBALL"',
  (run) => run.startsWith('node scripts/verify-published.mjs --tarball "$TARBALL"'),
];

/** Whether a step of a privileged job is outside the allowlist: an unknown run shape, an unknown action, a cached setup-node. */
function outsideAllowlist(step: Map): boolean {
  if (typeof step['run'] === 'string') {
    return !PRIVILEGED_RUN_SHAPES.some((shape) => shape(step['run'] as string));
  }
  const action = String(step['uses'] ?? '').split('@')[0] as string;
  if (!PRIVILEGED_ACTIONS.includes(action)) {
    return true;
  }

  return action === 'actions/setup-node' && step['with'] !== undefined && 'cache' in mapAt(step['with'], 'setup-node with');
}

const stepLabel = (step: Map): string => String(step['name'] ?? step['run'] ?? step['uses']).split('\n')[0] as string;

/** The entries of publish's checkout `sparse-checkout` (a scalar or a literal block), empty when there is none. */
function sparseEntries(flow: Map): string[] {
  const checkout = publishSteps(flow).find(usesAction('actions/checkout'));
  const sparse = checkout?.['with'] === undefined ? undefined : mapAt(checkout['with'], 'checkout with')['sparse-checkout'];

  return typeof sparse === 'string' ? sparse.split(/\r?\n/).map((entry) => entry.trim()).filter((entry) => entry !== '') : [];
}

/** The module specifiers a source file imports statically (`import … from`, `import '…'`, `export … from`) or dynamically. */
function importSpecifiers(source: string): string[] {
  const patterns = [
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s+[\w$*{][^'";]*?\s*from\s*['"]([^'"]+)['"]/g,
    /\bexport\s+(?:\*|\{[^}]*\})(?:\s+as\s+[\w$]+)?\s+from\s*['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1] as string));
}

/** The repository-relative file a relative `spec` names from `file`, or `undefined` when it is not relative or does not exist. */
function resolveImport(file: string, spec: string): string | undefined {
  if (!spec.startsWith('./') && !spec.startsWith('../')) {
    return undefined;
  }
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));

  return fs.statSync(path.join(ROOT, resolved), { throwIfNoEntry: false })?.isFile() === true ? resolved : undefined;
}

/**
 * Walks the static import closure of `entries` (repository-relative, `/`-separated). Returns every file visited and
 * every import that is neither a `node:` built-in nor a relative file inside one of `cone`'s folders.
 */
function importClosure(entries: readonly string[], cone: readonly string[]): { visited: string[]; escapes: string[] } {
  const visited: string[] = [];
  const escapes: string[] = [];
  const pending = [...entries];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (visited.includes(file)) {
      continue;
    }
    visited.push(file);
    for (const spec of importSpecifiers(fs.readFileSync(path.join(ROOT, file), 'utf8')).filter((candidate) => !candidate.startsWith('node:'))) {
      const target = resolveImport(file, spec);
      if (target !== undefined && cone.some((folder) => target.startsWith(`${folder}/`))) {
        pending.push(target);
      } else {
        escapes.push(`${file} imports ${spec}`);
      }
    }
  }

  return { visited, escapes };
}

/** Every file under `dir` (relative to the repository, `/`-separated), recursively. */
function filesUnder(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .flatMap((entry) => entry.isDirectory() ? filesUnder(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);
}

const manifest = (): { name: string; publishConfig: { registry: string } } =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { name: string; publishConfig: { registry: string } };

test('release.yml is started by a published release and by nothing else — no pull_request, push, dispatch or schedule', () => {
  const flow = workflow('release.yml');

  assert.deepEqual(triggersOf(flow, 'release.yml'), ['release']);
  assert.deepEqual(mapAt(mapAt(flow['on'], 'on')['release'], 'on.release'), { types: ['published'] });
});

test('no npm token exists anywhere: NPM_TOKEN appears in no workflow, no .github/scripts file, nothing under scripts/, and not in package.json', () => {
  const files = [...filesUnder('.github/workflows'), ...filesUnder('.github/scripts'), ...filesUnder('scripts'), 'package.json'];
  const named = files.filter((file) => fs.readFileSync(path.join(ROOT, file), 'utf8').includes('NPM_TOKEN'));

  assert.deepEqual(named, [], 'a file still names the npm token the publish no longer uses');
});

test('the publish job\'s permissions are exactly contents: read, packages: write, id-token: write, attestations: write — id-token and attestations are keys nowhere else in any workflow, and packages only at read, in the consume job', () => {
  const flow = workflow('release.yml');
  const grants = (file: string, key: string): [string, Yaml][] =>
    walk(workflow(file), file).filter(([at]) => at.endsWith(`.${key}`)).sort(([a], [b]) => a.localeCompare(b));

  assert.deepEqual(publishJob(flow)['permissions'], { contents: 'read', packages: 'write', 'id-token': 'write', attestations: 'write' });
  for (const key of PRIVILEGED_PERMISSIONS) {
    for (const file of allWorkflows()) {
      const expected: [string, Yaml][] = file !== 'release.yml' ? [] : key === 'packages'
        ? [['release.yml.jobs.consume.permissions.packages', 'read'], ['release.yml.jobs.publish.permissions.packages', 'write']]
        : [[`release.yml.jobs.publish.permissions.${key}`, 'write']];
      assert.deepEqual(grants(file, key), expected, `${file}: where "${key}" is granted, and at what level`);
    }
  }
});

test('release.yml: the top-level token reads contents only, and the publish job runs in the GitHub environment "npm", which holds no secret — its v* tag rule is the fence', () => {
  const flow = workflow('release.yml');

  assert.deepEqual(flow['permissions'], { contents: 'read' });
  assert.equal(publishJob(flow)['environment'], 'npm');
});

test('setup-node in the publish job points at package.json\'s publishConfig.registry — GitHub Packages — with the scope of the package name', () => {
  const setupNode = publishSteps(workflow('release.yml')).find((step) => String(step['uses']).startsWith('actions/setup-node@'));
  const inputs = mapAt(setupNode?.['with'], 'setup-node with');

  assert.equal(inputs['registry-url'], manifest().publishConfig?.registry, 'registry-url is not package.json\'s publishConfig.registry');
  assert.equal(inputs['registry-url'], 'https://npm.pkg.github.com');
  assert.equal(inputs['scope'], manifest().name.split('/')[0]);
});

test('the workflow runs npm pack in exactly ONE step — in the build job, id pack, which writes tarball= and the .sha256 — so exactly one tarball exists to be attested, published and verified', () => {
  const flow = workflow('release.yml');
  const packers = releaseSteps(flow).filter(([, step]) => runs(/\bnpm pack\b/)(step));

  assert.equal(packers.length, 1, `release.yml runs npm pack in ${packers.length} steps (${packers.map(([id, step]) => `${id}: ${stepLabel(step)}`).join('; ')}) — exactly one tarball may exist`);
  assert.equal(packers[0]?.[0], 'build', 'the one npm pack is not in the build job');
  assert.equal(packers[0]?.[1]['id'], 'pack', 'the one npm pack is not the step with id pack');
  assert.match(String(packers[0]?.[1]['run']), /tarball=.*>> *"\$GITHUB_OUTPUT"/, 'the pack step does not write tarball= to $GITHUB_OUTPUT');
  assert.match(String(packers[0]?.[1]['run']), /\.sha256/, 'the pack step does not write the .sha256 beside the tarball');
});

test('the build job runs the guard, installs, tests, packs ONCE and uploads — in that order — and the publish job attests, then publishes through publish-once, then verifies', () => {
  const flow = workflow('release.yml');
  const build = stepsOfJob(flow, 'build');
  const guard = indexOfStep(build, 'runs the release guard (build)', runs(/release-guard\.mjs/));
  const installed = indexOfStep(build, 'runs npm ci (build)', runs(/^npm ci$/));
  const tested = indexOfStep(build, 'runs npm test (build)', runs(/^npm test$/));
  const packed = indexOfStep(build, 'packs once (id: pack, build)', (step) => step['id'] === 'pack');
  const uploaded = indexOfStep(build, 'uploads the artifact (build)', usesAction('actions/upload-artifact'));
  assert.ok(guard < installed && installed < tested && tested < packed && packed < uploaded,
    `build order: guard ${guard}, ci ${installed}, test ${tested}, pack ${packed}, upload ${uploaded}`);

  const steps = publishSteps(flow);
  const attested = indexOfStep(steps, 'attests with actions/attest-build-provenance', (step) => /^actions\/attest-build-provenance@[0-9a-f]{40}$/.test(String(step['uses'])));
  const published = steps.indexOf(publishStep(steps));
  const verified = indexOfStep(steps, 'runs verify-published', runs(/verify-published\.mjs/));
  assert.ok(attested < published && published < verified, `publish order: attest ${attested}, publish ${published}, verify ${verified}`);
});

test('the attested subject, the published tarball and the verified tarball are ONE expression — steps.tarball.outputs.path — and the commands are exactly the two scripts', () => {
  const steps = publishSteps(workflow('release.yml'));
  const attest = steps.find(usesAction('actions/attest-build-provenance'));
  const publish = publishStep(steps);
  const verify = steps.find(runs(/verify-published\.mjs/));

  assert.equal(mapAt(attest?.['with'], 'attest with')['subject-path'], TARBALL_PATH);
  assert.equal(mapAt(publish['env'], 'publish env')['TARBALL'], TARBALL_PATH);
  assert.equal(mapAt(verify?.['env'], 'verify env')['TARBALL'], TARBALL_PATH);
  assert.equal(publish['run'], 'node scripts/publish-once.mjs "$TARBALL"');
  assert.equal(verify?.['run'], 'node scripts/verify-published.mjs --tarball "$TARBALL" --check version --check integrity --check attestation');
});

test('the job\'s own token is the only credential: NODE_AUTH_TOKEN on exactly the publish and verify steps of publish and the consume step of consume, GH_TOKEN on the verify step only, each ${{ secrets.GITHUB_TOKEN }}, and neither name anywhere else', () => {
  const flow = workflow('release.yml');
  const steps = publishSteps(flow);
  const consumer = releaseSteps(flow).find(([id, step]) => id !== 'publish' && runs(/pack-and-consume\.mjs --published/)(step));
  const at = (job: string, all: readonly Map[], step: Map | undefined): string => `release.yml.jobs.${job}.steps.${all.findIndex((candidate) => candidate === step)}.env`;
  const publish = publishStep(steps);
  const verify = steps.find(runs(/verify-published\.mjs/));
  const named = (name: string): string[] => stringsWith(flow, 'release.yml', name).concat(keysNamed(flow, 'release.yml', name)).sort();

  assert.ok(consumer !== undefined, 'no job other than publish runs the consumer fixture');
  const consumeJob = consumer[0];
  const consume = consumer[1];
  assert.deepEqual(named('NODE_AUTH_TOKEN'), [
    `${at('publish', steps, publish)}.NODE_AUTH_TOKEN`,
    `${at('publish', steps, verify)}.NODE_AUTH_TOKEN`,
    `${at(consumeJob, stepsOfJob(flow, consumeJob), consume)}.NODE_AUTH_TOKEN`,
  ].sort());
  assert.deepEqual(named('GH_TOKEN'), [`${at('publish', steps, verify)}.GH_TOKEN`]);
  for (const step of [publish, verify, consume]) {
    assert.equal(mapAt(step?.['env'], 'env')['NODE_AUTH_TOKEN'], JOB_TOKEN);
  }
  assert.equal(mapAt(verify?.['env'], 'verify env')['GH_TOKEN'], JOB_TOKEN);
});

test('a job that can publish or sign runs ONLY the tarball check, publish-once and verify-published, uses only checkout, setup-node (uncached), download-artifact and attest — no dependency code, in any workflow', () => {
  const offending = allWorkflows().flatMap((file) => {
    const jobs = jobsOf(workflow(file), file);

    return Object.entries(jobs)
      .filter(([id, job]) => isPrivileged(mapAt(job, id)))
      .map(([id, job]) => {
        const steps = mapAt(job, id)['steps'] === undefined ? [] : stepsOf(mapAt(job, id), id);
        const outside = steps.filter(outsideAllowlist).map(stepLabel);

        return mapAt(job, id)['steps'] === undefined ? `${file} ${id} calls a workflow whose steps are not readable here` : outside.length === 0 ? '' : `${file} ${id} runs steps outside the allowlist: ${outside.join(', ')}`;
      })
      .filter((message) => message !== '');
  });

  assert.deepEqual(offending, [], 'a privileged job (packages, id-token or attestations at write) runs something other than the three shapes');
});

test('the allowlist is not vacuous: the build job DOES run npm ci, npm test and npm pack — the dependency code the privileged job must never run', () => {
  const build = stepsOfJob(workflow('release.yml'), 'build');

  for (const command of ['ci', 'test', 'pack']) {
    assert.ok(build.some(runs(new RegExp(`\\bnpm\\s+${command}\\b`))), `the build job has no "npm ${command}" step`);
  }
});

test('the bytes are made unprivileged: build holds contents: read alone, outputs the ONE pack step\'s tarball name, and uploads it with the .sha256 under a pinned upload-artifact that errors on no files', () => {
  const flow = workflow('release.yml');
  const build = jobOf(flow, 'build');
  const upload = stepsOfJob(flow, 'build').find(usesAction('actions/upload-artifact'));

  assert.deepEqual(build['permissions'], { contents: 'read' });
  assert.deepEqual(build['outputs'], { tarball: '${{ steps.pack.outputs.tarball }}' });
  assert.equal(build['needs'], 'guard');
  assert.ok(upload !== undefined, 'the build job does not upload the tarball');
  assert.match(String(upload['uses']), /^actions\/upload-artifact@[0-9a-f]{40}$/);
  const inputs = mapAt(upload['with'], 'upload with');
  assert.equal(inputs['if-no-files-found'], 'error');
  assert.equal(inputs['path'], '${{ runner.temp }}/release/', 'the artifact is not the folder pack wrote the tarball and its .sha256 into');
});

test('the artifact outlives the re-run window: the upload keeps it at least 30 days, a number', () => {
  const upload = stepsOfJob(workflow('release.yml'), 'build').find(usesAction('actions/upload-artifact'));
  const retention = Number(mapAt(upload?.['with'], 'upload with')['retention-days']);

  assert.ok(Number.isInteger(retention) && retention >= 30, `retention-days is ${retention}; GitHub re-runs a workflow for 30 days, so the artifact must live that long`);
});

test('the privileged job works on the build\'s bytes: publish needs build, downloads the artifact build uploaded, checks its .sha256 before it attests, and the order is download, check, attest, publish, verify', () => {
  const flow = workflow('release.yml');
  const steps = publishSteps(flow);
  const upload = stepsOfJob(flow, 'build').find(usesAction('actions/upload-artifact'));
  const download = steps.find(usesAction('actions/download-artifact'));
  const check = steps.find((step) => step['id'] === 'tarball');

  assert.ok(listAt(publishJob(flow)['needs'], 'publish needs').includes('build'), 'publish does not need build');
  assert.ok(upload !== undefined && download !== undefined, 'the upload or the download step is missing');
  assert.match(String(download['uses']), /^actions\/download-artifact@[0-9a-f]{40}$/);
  assert.equal(mapAt(download['with'], 'download with')['name'], mapAt(upload['with'], 'upload with')['name'], 'publish downloads another artifact than the one build uploaded');
  assert.ok(check !== undefined, 'publish has no step with id tarball');
  assert.equal(mapAt(check['env'], 'tarball env')['TARBALL'], '${{ needs.build.outputs.tarball }}');
  assert.match(String(check['run']), /sha256sum -c "\$TARBALL\.sha256"/);
  assert.match(String(check['run']), /grep -Eqx/, 'the tarball step does not refuse a name that is not a plain .tgz file name before using it');
  // sha256sum writes `hash  name` in text mode and `hash *name` in binary mode; the name is read in either.
  assert.match(String(check['run']), /awk '\{sub\(\/\^\\\*\/, "", \$2\); print \$2\}' "\$TARBALL\.sha256"/, 'the tarball step does not check, in text and binary mode alike, that the .sha256 names exactly that file');
  assert.match(String(check['run']), /::error::/, 'the tarball step does not say why it refuses');
  assert.match(String(check['run']), /path=.*>> *"\$GITHUB_OUTPUT"/, 'the tarball step does not write path= to $GITHUB_OUTPUT');

  const downloaded = steps.indexOf(download);
  const checked = steps.indexOf(check);
  const attested = indexOfStep(steps, 'attests', usesAction('actions/attest-build-provenance'));
  const published = steps.indexOf(publishStep(steps));
  const verified = indexOfStep(steps, 'runs verify-published', runs(/verify-published\.mjs/));
  assert.ok(downloaded < checked && checked < attested && attested < published && published < verified,
    `order: download ${downloaded}, check ${checked}, attest ${attested}, publish ${published}, verify ${verified}`);
});

test('the privileged job checks out scripts alone, without credentials: publish\'s checkout has a sparse-checkout naming scripts and persist-credentials: false', () => {
  const flow = workflow('release.yml');
  const checkout = publishSteps(flow).find(usesAction('actions/checkout'));

  assert.ok(checkout !== undefined, 'publish has no checkout');
  assert.ok(sparseEntries(flow).includes('scripts'), `publish's checkout sparse-checkout is ${JSON.stringify(sparseEntries(flow))}, which does not name scripts`);
  assert.equal(mapAt(checkout['with'], 'checkout with')['persist-credentials'], 'false');
});

test('the privileged scripts import only node: built-ins and files inside the sparse-checkout cone — publish-once.mjs, verify-published.mjs and, through them, scripts/lib/npm.mjs', () => {
  const cone = sparseEntries(workflow('release.yml'));
  assert.ok(cone.length > 0, 'publish\'s checkout has no sparse-checkout, so every file of the repository is in the cone');
  const { visited, escapes } = importClosure(['scripts/publish-once.mjs', 'scripts/verify-published.mjs'], cone);

  assert.deepEqual(escapes, [], `a privileged script imports something the sparse checkout (${cone.join(', ')}) does not carry`);
  assert.ok(visited.includes('scripts/lib/npm.mjs'), `the walk did not reach scripts/lib/npm.mjs (visited: ${visited.join(', ')}) — the import reader is blind`);
});

test('the consumer fixture runs unprivileged and after the publish: a job other than publish runs pack-and-consume --published, needs publish, holds contents: read and packages: read, with the job token', () => {
  const flow = workflow('release.yml');
  const consumer = releaseSteps(flow).find(([id, step]) => id !== 'publish' && runs(/^node scripts\/pack-and-consume\.mjs --published$/)(step));

  assert.ok(consumer !== undefined, 'no job other than publish runs node scripts/pack-and-consume.mjs --published');
  const job = jobOf(flow, consumer[0]);
  assert.ok(listAt(job['needs'], `${consumer[0]} needs`).includes('publish'), `${consumer[0]} does not need publish`);
  assert.deepEqual(job['permissions'], { contents: 'read', packages: 'read' });
  assert.equal(mapAt(consumer[1]['env'], 'consume env')['NODE_AUTH_TOKEN'], JOB_TOKEN);
});

test('no run: in any workflow publishes by hand (npm publish), asks for npm provenance (--provenance) or an access level (--access)', () => {
  const offending = allWorkflows().flatMap((file) => {
    const jobs = jobsOf(workflow(file), file);

    return Object.entries(jobs)
      .filter(([id, job]) => mapAt(job, id)['steps'] !== undefined)
      .flatMap(([id, job]) => stepsOf(mapAt(job, id), id))
      .filter(runs(/\bnpm publish\b|--provenance|--access/))
      .map((step) => `${file}: ${String(step['name'] ?? step['run'])}`);
  });

  assert.deepEqual(offending, [], 'a run: script publishes outside publish-once.mjs, or asks for what GitHub Packages does not take');
});

test('release.yml: the publish job needs the guard, its own in-file call of the reusable pack-and-consume workflow, AND the build', () => {
  const jobs = jobsOf(workflow('release.yml'), 'release.yml');
  const call = packAndConsumeCall(jobs);
  const needs = listAt(mapAt(jobs['publish'], 'publish')['needs'], 'publish needs');

  assert.ok(needs.includes(call), `publish needs ${JSON.stringify(needs)}, not the pack-and-consume call "${call}"`);
  assert.ok(needs.includes('guard'), `publish needs ${JSON.stringify(needs)}, not the guard`);
  assert.ok(needs.includes('build'), `publish needs ${JSON.stringify(needs)}, not the build`);
  assert.equal(mapAt(jobs[call], call)['needs'], 'guard', 'pack-and-consume runs only once the guard passed');
});

test('release.yml: the guard job checks the event through the script, with every event value passed as an environment variable', () => {
  const jobs = jobsOf(workflow('release.yml'), 'release.yml');
  const guardSteps = stepsOf(mapAt(jobs['guard'], 'guard'), 'guard');
  const guard = guardSteps.find((step) => step['run'] === 'node .github/scripts/release-guard.mjs');

  assert.ok(guard !== undefined, 'the guard job does not run release-guard.mjs');
  assert.deepEqual(Object.keys(mapAt(guard['env'], 'guard env')).sort(), ['RELEASE_AUTHOR_TYPE', 'RELEASE_DRAFT', 'RELEASE_PRERELEASE', 'RELEASE_TAG']);
});

test('neither release workflow pastes an expression into a run: script — event and secret values arrive as environment variables', () => {
  for (const file of ['release.yml', 'release-please.yml']) {
    const jobs = jobsOf(workflow(file), file);
    const pasted = Object.entries(jobs)
      .filter(([id, job]) => mapAt(job, id)['steps'] !== undefined)
      .flatMap(([id, job]) => stepsOf(mapAt(job, id), id))
      .filter((step) => typeof step['run'] === 'string' && step['run'].includes('${{'))
      .map((step) => String(step['name'] ?? step['run']));
    assert.deepEqual(pasted, [], `${file}: an expression is pasted into a run: script`);
  }
});

test('no other workflow is started by a release, holds id-token, or reads NPM_TOKEN', () => {
  for (const file of allWorkflows().filter((name) => name !== 'release.yml')) {
    const flow = workflow(file);
    assert.ok(!triggersOf(flow, file).includes('release'), `${file} is started by a release`);
    assert.deepEqual(keysNamed(flow, file, 'id-token'), [], `${file} asks for id-token`);
    assert.deepEqual(stringsWith(flow, file, 'NPM_TOKEN'), [], `${file} reads NPM_TOKEN`);
  }
});

test('the workflow release.yml calls is reusable and cannot itself be started by a pull request', () => {
  const flow = workflow('pack-and-consume.yml');

  assert.deepEqual(triggersOf(flow, 'pack-and-consume.yml').sort(), ['workflow_call', 'workflow_dispatch']);
  assert.deepEqual(flow['permissions'], { contents: 'read' });
});

test('release-please.yml runs on pushes to main (and by hand), never for a pull request, and proposes with the App token, not GITHUB_TOKEN', () => {
  const flow = workflow('release-please.yml');
  const triggers = triggersOf(flow, 'release-please.yml');

  assert.deepEqual(triggers.sort(), ['push', 'workflow_dispatch']);
  assert.deepEqual(mapAt(mapAt(flow['on'], 'on')['push'], 'on.push'), { branches: ['main'] });
  const steps = stepsOf(mapAt(jobsOf(flow, 'release-please.yml')['release-please'], 'release-please'), 'release-please');
  const mint = steps.findIndex((step) => String(step['uses']).startsWith('actions/create-github-app-token@'));
  const action = steps.findIndex((step) => String(step['uses']).startsWith('googleapis/release-please-action@'));
  assert.ok(mint > 0 && action > mint, `the secrets check, then the mint, then release-please (mint ${mint}, action ${action})`);
  assert.deepEqual(mapAt(steps[mint]?.['with'], 'mint with'), {
    'app-id': '${{ secrets.RELEASE_PLEASE_APP_ID }}',
    'private-key': '${{ secrets.RELEASE_PLEASE_APP_PRIVATE_KEY }}',
  });
  assert.equal(steps[mint]?.['id'], 'token');
  assert.deepEqual(mapAt(steps[action]?.['with'], 'release-please with'), {
    'config-file': 'release-please-config.json',
    'manifest-file': '.release-please-manifest.json',
    token: '${{ steps.token.outputs.token }}',
  });
  assert.match(String(steps[0]?.['run']), /exit 1/, 'missing App secrets are a red run with a reason');
});

test('every action a workflow uses is pinned to a full commit SHA with its version in a comment, and every checkout drops its credentials', () => {
  for (const file of allWorkflows()) {
    const text = fs.readFileSync(path.join(WORKFLOWS, file), 'utf8');
    const flow = workflow(file);
    for (const [at, value] of walk(flow, file).filter(([where]) => where.endsWith('.uses'))) {
      const uses = String(value);
      if (uses.startsWith('./')) {
        continue;
      }
      assert.match(uses, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${at} is not pinned to a commit: ${uses}`);
      assert.match(text, new RegExp(`${uses.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} # v\\d`), `${at} has no "# v…" comment naming the version`);
    }
    for (const [at, value] of walk(flow, file).filter(([where, v]) => where.endsWith('.uses') && String(v).startsWith('actions/checkout@'))) {
      const step = at.slice(0, -'.uses'.length);
      const withAt = walk(flow, file).find(([where]) => where === `${step}.with`)?.[1];
      assert.equal(mapAt(withAt ?? null, `${step}.with`)['persist-credentials'], 'false', `${at} keeps its credentials (${String(value)})`);
    }
  }
});

test('no pull-request event starts a release workflow, and a pull_request_target workflow never touches the pull request\'s head', () => {
  for (const file of allWorkflows()) {
    const flow = workflow(file);
    const prTriggers = triggersOf(flow, file).filter((trigger) => PULL_REQUEST_TRIGGERS.includes(trigger));
    if (prTriggers.includes('pull_request_target')) {
      assert.deepEqual(stringsWith(flow, file, 'github.event.pull_request.head'), [], `${file} runs on pull_request_target and touches the head`);
    }
    if (['release.yml', 'release-please.yml', 'pack-and-consume.yml'].includes(file)) {
      assert.deepEqual(prTriggers, [], `${file} is started by ${prTriggers.join(', ')}`);
    }
  }
});

test('pr-title.yml runs "documentation alone never opens a release" from main\'s copy, with the title passed as data', () => {
  const flow = workflow('pr-title.yml');
  const steps = stepsOf(mapAt(jobsOf(flow, 'pr-title.yml')['semantic'], 'semantic'), 'semantic');
  const check = steps.find((step) => step['name'] === 'Documentation alone never opens a release');

  assert.ok(check !== undefined, 'the docs-only step is missing');
  assert.equal(check['run'], 'node .github/scripts/docs-only-title.mjs --pr "$PR_NUMBER"');
  assert.deepEqual(check['env'], {
    GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
    PR_NUMBER: '${{ github.event.pull_request.number }}',
    PR_TITLE: '${{ github.event.pull_request.title }}',
  });
  assert.deepEqual(flow['permissions'], { 'pull-requests': 'read', contents: 'read' });
});
