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

const publishSteps = (flow: Map): Map[] => stepsOf(mapAt(jobsOf(flow, 'release.yml')['publish'], 'publish'), 'publish');
const publishJob = (flow: Map): Map => mapAt(jobsOf(flow, 'release.yml')['publish'], 'publish');
const runs = (pattern: RegExp) => (step: Map): boolean => typeof step['run'] === 'string' && pattern.test(step['run']);
const PACKED = '${{ steps.pack.outputs.tarball }}';
const JOB_TOKEN = '${{ secrets.GITHUB_TOKEN }}';

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

test('the publish job\'s permissions are exactly contents: read, packages: write, id-token: write, attestations: write — and packages, id-token and attestations are keys nowhere else in any workflow', () => {
  const flow = workflow('release.yml');

  assert.deepEqual(publishJob(flow)['permissions'], { contents: 'read', packages: 'write', 'id-token': 'write', attestations: 'write' });
  for (const key of ['packages', 'id-token', 'attestations']) {
    for (const file of allWorkflows()) {
      assert.deepEqual(keysNamed(workflow(file), file, key), file === 'release.yml' ? [`release.yml.jobs.publish.permissions.${key}`] : [], `${file}: where "${key}" is granted`);
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

test('the publish job packs ONCE, then attests that tarball, then publishes it through publish-once, then verifies, then consumes — after the guard and npm test', () => {
  const steps = publishSteps(workflow('release.yml'));
  const index = (what: string, found: (step: Map) => boolean): number => {
    const at = steps.findIndex(found);
    assert.ok(at >= 0, `the publish job has no step that ${what}`);
    return at;
  };
  const guard = index('runs the release guard', runs(/release-guard\.mjs/));
  const tested = index('runs npm test', runs(/^npm test$/));
  const packed = index('packs once (id: pack)', (step) => step['id'] === 'pack');
  const attested = index('attests with actions/attest-build-provenance', (step) => /^actions\/attest-build-provenance@[0-9a-f]{40}$/.test(String(step['uses'])));
  const published = steps.indexOf(publishStep(steps));
  const verified = index('runs verify-published', runs(/verify-published\.mjs/));
  const consumed = index('runs pack-and-consume against the published version', runs(/pack-and-consume\.mjs --published/));

  assert.ok(guard < tested && tested < packed && packed < attested && attested < published && published < verified && verified < consumed,
    `order: guard ${guard}, test ${tested}, pack ${packed}, attest ${attested}, publish ${published}, verify ${verified}, consume ${consumed}`);
  const packers = steps.filter(runs(/\bnpm pack\b/));
  assert.equal(packers.length, 1, `the publish job runs npm pack in ${packers.length} steps — exactly one tarball may exist`);
  assert.equal(packers[0], steps[packed], 'the one npm pack is not the step with id pack');
  assert.match(String(steps[packed]?.['run']), /tarball=.*>> *"\$GITHUB_OUTPUT"/, 'the pack step does not write tarball= to $GITHUB_OUTPUT');
});

test('the attested subject, the published tarball and the verified tarball are ONE expression — steps.pack.outputs.tarball — and the commands are exactly the two scripts', () => {
  const steps = publishSteps(workflow('release.yml'));
  const attest = steps.find((step) => String(step['uses']).startsWith('actions/attest-build-provenance@'));
  const publish = publishStep(steps);
  const verify = steps.find(runs(/verify-published\.mjs/));

  assert.equal(mapAt(attest?.['with'], 'attest with')['subject-path'], PACKED);
  assert.equal(mapAt(publish['env'], 'publish env')['TARBALL'], PACKED);
  assert.equal(mapAt(verify?.['env'], 'verify env')['TARBALL'], PACKED);
  assert.equal(publish['run'], 'node scripts/publish-once.mjs "$TARBALL"');
  assert.equal(verify?.['run'], 'node scripts/verify-published.mjs --tarball "$TARBALL" --check version --check integrity --check attestation');
});

test('the job\'s own token is the only credential: NODE_AUTH_TOKEN on exactly the publish, verify and consume steps, GH_TOKEN on the verify step only, each ${{ secrets.GITHUB_TOKEN }}, and neither name anywhere else', () => {
  const flow = workflow('release.yml');
  const steps = publishSteps(flow);
  const at = (step: Map | undefined): string => `release.yml.jobs.publish.steps.${steps.findIndex((candidate) => candidate === step)}.env`;
  const publish = publishStep(steps);
  const verify = steps.find(runs(/verify-published\.mjs/));
  const consume = steps.find(runs(/pack-and-consume\.mjs --published/));
  const named = (name: string): string[] => stringsWith(flow, 'release.yml', name).concat(keysNamed(flow, 'release.yml', name)).sort();

  assert.deepEqual(named('NODE_AUTH_TOKEN'), [publish, verify, consume].map((step) => `${at(step)}.NODE_AUTH_TOKEN`).sort());
  assert.deepEqual(named('GH_TOKEN'), [`${at(verify)}.GH_TOKEN`]);
  for (const step of [publish, verify, consume]) {
    assert.equal(mapAt(step?.['env'], 'env')['NODE_AUTH_TOKEN'], JOB_TOKEN);
  }
  assert.equal(mapAt(verify?.['env'], 'verify env')['GH_TOKEN'], JOB_TOKEN);
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

test('release.yml: the publish job needs the guard AND its own in-file call of the reusable pack-and-consume workflow', () => {
  const jobs = jobsOf(workflow('release.yml'), 'release.yml');
  const call = packAndConsumeCall(jobs);
  const needs = listAt(mapAt(jobs['publish'], 'publish')['needs'], 'publish needs');

  assert.ok(needs.includes(call), `publish needs ${JSON.stringify(needs)}, not the pack-and-consume call "${call}"`);
  assert.ok(needs.includes('guard'), `publish needs ${JSON.stringify(needs)}, not the guard`);
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
