import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { FakeDocument } from './fakeDom';
import { GALLERY } from './gallery';
import { listAt, mapAt, parseWorkflow } from './workflowYaml';

/**
 * What the layout check stands on, without a browser (`research/PLAN_kit_components_storybook.md` §4.6a, §5.2 items 27-28).
 * The check itself runs Chrome - `npm run layout-check`, and its companion `npm run layout-check -- --companion` - in
 * CI's storybook job; these tests hold what it needs to be worth running: the gallery has the cases that would break
 * it, CI really runs both modes, a missing browser is a failed run rather than a skip, and a wrong argument is a usage
 * error.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'layout-check.mjs');

const tableCases = (): readonly { id: string; render: (doc: FakeDocument) => unknown }[] => {
  const cases = GALLERY.find((component) => component.id === 'dataTable')?.cases ?? [];

  return cases.flatMap((entry) => (entry.kind === 'dom' ? [{ id: entry.id, render: (doc: FakeDocument) => entry.render(doc) }] : []));
};

function rendered(id: string): { doc: FakeDocument; root: ReturnType<FakeDocument['node']> } {
  const doc = new FakeDocument();
  const found = tableCases().find((entry) => entry.id === id) ?? assert.fail(`the gallery has no dataTable/${id}`);

  return { doc, root: doc.node(found.render(doc)) };
}

test('the gallery has the DataTable cases that would break "a table fits its box": eight columns in an 18em box, an unbreakable word, a long header, and a stacked case per width', () => {
  assert.deepEqual(['eight-columns', 'unbreakable-cell', 'long-header', 'stack-narrow', 'stack-medium', 'stack-wide', 'stack-never'].filter((id) => !tableCases().some((entry) => entry.id === id)), []);

  const eight = rendered('eight-columns').root;
  assert.ok(eight.classes.includes('gallery-narrow'), 'the eight-column table is not in the narrow box');
  assert.equal(eight.all('th').length, 8);

  const words = rendered('unbreakable-cell').root.all('td').map((cell) => cell.textContent).flatMap((text) => text.split(/\s+/));
  assert.ok(Math.max(...words.map((word) => word.length)) >= 60, 'no cell holds a word of 60 characters or more');

  const headers = rendered('long-header').root.all('th').map((cell) => cell.textContent);
  assert.ok(Math.max(...headers.map((header) => header.length)) >= 40, 'no header is 40 characters or longer');

  for (const stack of ['narrow', 'medium', 'wide', 'never']) {
    assert.equal(rendered(`stack-${stack}`).root.all(`table.kit-table--stack-${stack}`).length, 1, `stack-${stack} does not render its stack option`);
  }
});

test('package.json has the layout-check script and CI\'s storybook job runs it AND its companion, after the build', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  assert.equal(manifest.scripts['layout-check'], 'node scripts/layout-check.mjs');

  const ci = mapAt(parseWorkflow(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')), 'ci.yml');
  const job = mapAt(mapAt(ci['jobs'], 'jobs')['storybook'], 'storybook');
  assert.equal(job['runs-on'], 'ubuntu-latest', 'Google Chrome is on GitHub\'s ubuntu image');
  const runs = listAt(job['steps'], 'steps').flatMap((step) => {
    const run = mapAt(step, 'a step')['run'];

    return typeof run === 'string' ? [run] : [];
  });
  assert.ok(runs.includes('npm run layout-check'), `the layout check is not a step: ${runs.join(' | ')}`);
  assert.ok(runs.includes('npm run layout-check -- --companion'), 'the companion is not a step');
  assert.ok(runs.indexOf('npm run build-storybook') < runs.indexOf('npm run layout-check'), 'the layout check must come after the Storybook build');
});

/**
 * The script run with its browser lookup pointed at nothing. A `CHROME_PATH` naming a missing file is the lookup every
 * platform honours; on Linux the PATH search can be emptied too (Windows resets `ProgramFiles` for a child process, so
 * its install-path search cannot be hidden from a test).
 */
function withoutChrome(args: readonly string[], env: NodeJS.ProcessEnv): { status: number | null; said: string } {
  const ran = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 240_000, env: { ...process.env, ...env } });
  assert.equal(ran.error, undefined, `could not run: ${String(ran.error)}`);

  return { status: ran.status, said: `${ran.stdout}${ran.stderr}` };
}

function noProfileLeft(): void {
  assert.equal(fs.existsSync(path.join(ROOT, 'testsToDelete-layout-check')), false, 'the profile folder was left behind');
}

test('a CHROME_PATH that names nothing FAILS the check saying so - exit 3, never a skip, never another browser - and leaves no profile folder', { timeout: 300_000 }, () => {
  const missing = path.join(os.tmpdir(), 'kit-no-such-chrome', 'chrome');
  const { status, said } = withoutChrome([], { CHROME_PATH: missing });

  assert.equal(status, 3, said);
  assert.match(said, /CHROME_PATH is set to .*kit-no-such-chrome.*which does not exist/);
  noProfileLeft();
});

test('with no browser anywhere on PATH (Linux) the check FAILS saying so - exit 3 - and leaves no profile folder', { timeout: 300_000 }, () => {
  if (process.platform !== 'linux') {
    // Only Linux searches PATH; the CHROME_PATH test above is the other platforms' proof of the same exit.
    return;
  }
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-no-chrome-'));
  try {
    const { status, said } = withoutChrome([], { CHROME_PATH: '', PATH: empty });

    assert.equal(status, 3, said);
    assert.match(said, /no Chrome found: set CHROME_PATH/);
    noProfileLeft();
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('an unknown argument is a usage error, exit 2, before any browser is looked for', { timeout: 300_000 }, () => {
  const { status, said } = withoutChrome(['--everything'], {});

  assert.equal(status, 2, said);
  assert.match(said, /usage: node scripts\/layout-check\.mjs \[--companion\]/);
});

/**
 * `scripts/layout/cleanup.mjs` - what the check does AFTER the browser work: retry the removal of the profile folder a
 * bounded number of times, and never let a failed removal replace the check's own result. An ES module outside the
 * TypeScript program, so each case runs its body in a `node --input-type=module` child with the library imported; a body
 * that throws is a failed case, and its message is what the test prints.
 */
const CLEANUP = pathToFileURL(path.join(ROOT, 'scripts', 'layout', 'cleanup.mjs')).href;

function inChild(body: string): void {
  const code = ['import assert from "node:assert/strict";', 'const { EnvironmentError, endpointOf, inlineStyle, removeWithRetry, runThenRemove, spawnBrowser, startOrEnd, withTimeout } = await import(process.env.KIT_LIB);', body].join('\n');
  const ran = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, KIT_LIB: CLEANUP, KIT_PORT_FILE: path.join(os.tmpdir(), 'kit-no-such-port-file') } });
  assert.equal(ran.error, undefined, `could not run: ${String(ran.error)}`);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
}

test('removeWithRetry: a removal that fails N times and then works resolves, after exactly N+1 calls and N pauses', () => {
  inChild(`
    let calls = 0; const pauses = [];
    const answer = await removeWithRetry(() => { calls += 1; if (calls <= 3) { throw new Error('busy ' + calls); } return 'gone'; },
      { attempts: 10, pauseMs: 500, sleep: async (ms) => { pauses.push(ms); } });
    assert.equal(answer, 'gone'); assert.equal(calls, 4); assert.deepEqual(pauses, [500, 500, 500]);
  `);
});

test('removeWithRetry is bounded: a removal that always fails is called exactly `attempts` times, pauses between them only, and the LAST error is thrown', () => {
  inChild(`
    let calls = 0; let pauses = 0;
    await assert.rejects(removeWithRetry(() => { calls += 1; throw new Error('busy ' + calls); },
      { attempts: 240, pauseMs: 500, sleep: async () => { pauses += 1; } }), { message: 'busy 240' });
    assert.equal(calls, 240); assert.equal(pauses, 239);
  `);
});

test('a failing removal after a PASSING run leaves the run passing - the warning is the only trace', () => {
  inChild(`
    const warned = []; const order = [];
    const outcome = await runThenRemove(async () => { order.push('run'); return 0; },
      { stop: async () => { order.push('stop'); }, remove: async () => { order.push('remove'); throw new Error('EPERM busy'); }, warn: (error) => warned.push(error.message) });
    assert.equal(outcome, 0); assert.deepEqual(warned, ['EPERM busy']); assert.deepEqual(order, ['run', 'stop', 'remove']);
  `);
});

test('a failing removal after a FAILING run rethrows the RUN\'s error, not the removal\'s - and a failed run still stops and removes', () => {
  inChild(`
    const warned = []; const order = [];
    await assert.rejects(runThenRemove(async () => { order.push('run'); throw new Error('the check broke'); },
      { stop: async () => { order.push('stop'); }, remove: async () => { order.push('remove'); throw new Error('EPERM busy'); }, warn: (error) => warned.push(error.message) }),
      { message: 'the check broke' });
    assert.deepEqual(warned, ['EPERM busy']); assert.deepEqual(order, ['run', 'stop', 'remove']);
  `);
});

test('a removal that works is silent: no warning, the run\'s answer unchanged', () => {
  inChild(`
    const warned = [];
    const outcome = await runThenRemove(async () => 1, { stop: async () => undefined, remove: async () => undefined, warn: (error) => warned.push(error.message) });
    assert.equal(outcome, 1); assert.deepEqual(warned, []);
  `);
});

test('a browser that never opens its DevTools port is ENDED by the handle it was started with, its exit awaited, and the port-timeout error is what is thrown', () => {
  inChild(`
    const child = { exitCode: null, id: 'fake-chrome' }; const ended = []; const waited = [];
    const failure = await startOrEnd({
      spawnChild: () => ({ child }),
      endpointOf: ({ child }) => endpointOf(child, { portFile: process.env.KIT_PORT_FILE, waitMs: 60, pollMs: 5 }),
      end: (started) => { ended.push(started.child.id); },
      waitForExit: async (started) => { waited.push(started.child.id); },
    }).then(() => assert.fail('it started'), (error) => error);
    assert.ok(failure instanceof EnvironmentError, String(failure));
    assert.match(failure.message, /Chrome did not open its DevTools port within 0\\.06 s/);
    assert.deepEqual(ended, ['fake-chrome']); assert.deepEqual(waited, ['fake-chrome']);
  `);
});

test('a browser that exits before it opens its port is still ended by handle, and that error is what is thrown', () => {
  inChild(`
    const ended = [];
    const failure = await startOrEnd({
      spawnChild: () => ({ child: { exitCode: 7, id: 'dead-chrome' } }),
      endpointOf: ({ child }) => endpointOf(child, { portFile: process.env.KIT_PORT_FILE, waitMs: 60, pollMs: 5 }),
      end: (started) => { ended.push(started.child.id); },
      waitForExit: async () => undefined,
    }).then(() => assert.fail('it started'), (error) => error);
    assert.match(failure.message, /Chrome exited with code 7 before it opened its DevTools port/);
    assert.deepEqual(ended, ['dead-chrome']);
  `);
});

test('a browser that opens its port is returned with its endpoint and is NOT ended', () => {
  inChild(`
    const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-port-'));
    const portFile = path.join(dir, 'DevToolsActivePort'); fs.writeFileSync(portFile, '9222\\n/devtools/browser/abc\\n');
    try {
      const ended = [];
      const started = await startOrEnd({
        spawnChild: () => ({ child: { exitCode: null, id: 'live-chrome' } }),
        endpointOf: ({ child }) => endpointOf(child, { portFile, waitMs: 1000, pollMs: 5 }),
        end: (s) => { ended.push(s.child.id); }, waitForExit: async () => undefined,
      });
      assert.equal(started.endpoint, 'ws://127.0.0.1:9222/devtools/browser/abc'); assert.equal(started.child.id, 'live-chrome'); assert.deepEqual(ended, []);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  `);
});

test('a port file Chrome still holds open (EBUSY on Windows) is "not yet", not a failure: the endpoint is read on a later poll', () => {
  inChild(`
    const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-busy-')); const portFile = path.join(dir, 'DevToolsActivePort'); fs.writeFileSync(portFile, 'held open by Chrome');
    let reads = 0;
    const read = () => { reads += 1; if (reads <= 2) { throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }); } return '9222\\n/devtools/browser/abc\\n'; };
    try {
      const endpoint = await endpointOf({ exitCode: null }, { portFile, waitMs: 1000, pollMs: 5, read });
      assert.equal(endpoint, 'ws://127.0.0.1:9222/devtools/browser/abc'); assert.equal(reads, 3);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  `);
});

test('a port file that NEVER becomes readable still ends in the bounded port timeout, and the error names the unreadable file and its code', () => {
  inChild(`
    const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-busy-')); const portFile = path.join(dir, 'DevToolsActivePort'); fs.writeFileSync(portFile, 'held open by Chrome');
    let reads = 0;
    const read = () => { reads += 1; throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }); };
    try {
      await assert.rejects(endpointOf({ exitCode: null }, { portFile, waitMs: 50, pollMs: 5, read }), (error) => {
        assert.ok(error instanceof EnvironmentError, 'not an EnvironmentError: ' + error);
        assert.match(error.message, /did not open its DevTools port within 0\\.05 s/);
        assert.match(error.message, /could not be read: EBUSY/);
        return true;
      });
      assert.ok(reads > 1, 'the unreadable file was not polled more than once');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  `);
});

test('stop() throwing never replaces the run\'s error - it is reported, and the removal still runs', () => {
  inChild(`
    const warned = []; const order = [];
    await assert.rejects(runThenRemove(async () => { throw new Error('A: the check broke'); },
      { stop: async () => { order.push('stop'); throw new Error('B: stop failed'); }, remove: async () => { order.push('remove'); }, warn: (error) => warned.push(error.message) }),
      { message: 'A: the check broke' });
    assert.deepEqual(warned, ['B: stop failed']); assert.deepEqual(order, ['stop', 'remove']);
  `);
});

test('stop() throwing after a PASSING run leaves it passing, with the warning, and the removal still runs', () => {
  inChild(`
    const warned = []; const order = [];
    const outcome = await runThenRemove(async () => 0,
      { stop: async () => { order.push('stop'); throw new Error('B: stop failed'); }, remove: async () => { order.push('remove'); }, warn: (error) => warned.push(error.message) });
    assert.equal(outcome, 0); assert.deepEqual(warned, ['B: stop failed']); assert.deepEqual(order, ['stop', 'remove']);
  `);
});

test('startOrEnd: an end() or waitForExit() that throws never replaces the original error - it is reported through warn', () => {
  inChild(`
    const warned = [];
    const base = { spawnChild: () => ({ child: {} }), endpointOf: async () => { throw new EnvironmentError('the port never opened'); } };
    await assert.rejects(startOrEnd({ ...base, end: () => { throw new Error('taskkill missing'); }, waitForExit: async () => undefined, warn: (error) => warned.push(error.message) }), { message: 'the port never opened' });
    await assert.rejects(startOrEnd({ ...base, end: () => undefined, waitForExit: async () => { throw new Error('wait broke'); }, warn: (error) => warned.push(error.message) }), { message: 'the port never opened' });
    assert.deepEqual(warned, ['taskkill missing', 'wait broke']);
  `);
});

test('a spawn that fails (ENOENT) is not swallowed: the wait rejects at once with "could not start Chrome: <message>", and the child is ended', () => {
  inChild(`
    const { EventEmitter } = await import('node:events');
    const ended = [];
    const fake = new EventEmitter(); fake.exitCode = null;
    const spawnProcess = () => { setImmediate(() => fake.emit('error', new Error('spawn chrome ENOENT'))); return fake; };
    const started = Date.now();
    const failure = await startOrEnd({
      spawnChild: () => spawnBrowser(spawnProcess, 'chrome', []),
      endpointOf: (s) => endpointOf(s.child, { portFile: process.env.KIT_PORT_FILE, waitMs: 60_000, pollMs: 5, startError: () => s.record.error }),
      end: (s) => { ended.push(s.child === fake); }, waitForExit: (s) => s.exited,
    }).then(() => assert.fail('it started'), (error) => error);
    assert.ok(failure instanceof EnvironmentError); assert.equal(failure.message, 'could not start Chrome: spawn chrome ENOENT');
    assert.ok(Date.now() - started < 5000, 'it waited out the 60 s');
    assert.deepEqual(ended, [true]);
  `);
});

test('a port file that is not a DevTools endpoint never yields one, and the timeout error says what it held', () => {
  inChild(`
    const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-badport-'));
    try {
      for (const [content, why] of [['9222\\n/?token=x\\n', '/?token=x'], ['99999\\n/devtools/browser/a\\n', '99999'], ['92x2\\n/devtools/browser/a\\n', '92x2'], ['9222\\n/devtools/browser/a b\\n', 'a b'], ['0\\n/devtools/browser/a\\n', '0'], ['9222\\n/devtools/browser/a#frag\\n', 'a#frag']]) {
        const portFile = path.join(dir, 'DevToolsActivePort'); fs.writeFileSync(portFile, content);
        const failure = await endpointOf({ exitCode: null }, { portFile, waitMs: 40, pollMs: 5 }).then((url) => assert.fail('built ' + url), (error) => error);
        assert.match(failure.message, /did not open its DevTools port/); assert.ok(failure.message.includes('not a DevTools endpoint'), failure.message); assert.ok(failure.message.includes(why), failure.message);
      }
      fs.writeFileSync(path.join(dir, 'ok'), '65535\\n/devtools/browser/abc-1\\n');
      assert.equal(await endpointOf({ exitCode: null }, { portFile: path.join(dir, 'ok'), waitMs: 1000, pollMs: 5 }), 'ws://127.0.0.1:65535/devtools/browser/abc-1');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  `);
});

test('withTimeout: answers what the promise answered, rejects with an EnvironmentError NAMING what timed out, and runs the clean-up hook on the timeout only', () => {
  inChild(`
    let closed = 0;
    assert.equal(await withTimeout(Promise.resolve('fine'), 1000, 'the DevTools command Foo.bar', () => { closed += 1; }), 'fine');
    await assert.rejects(withTimeout(Promise.reject(new Error('its own')), 1000, 'x', () => { closed += 1; }), { message: 'its own' });
    assert.equal(closed, 0);
    const failure = await withTimeout(new Promise(() => undefined), 30, 'the DevTools command Foo.bar', () => { closed += 1; }).then(() => assert.fail('answered'), (error) => error);
    assert.ok(failure instanceof EnvironmentError); assert.match(failure.message, /the DevTools command Foo\\.bar did not answer within 0\\.03 s/); assert.equal(closed, 1);
  `);
});

test('withTimeout: an onTimeout that THROWS still ends the wait - it rejects at once with the timeout error (the hook\'s failure appended) - even when the wrapped promise never settles', () => {
  inChild(`
    const started = Date.now();
    const failure = await withTimeout(new Promise(() => undefined), 30, 'the DevTools command Foo.bar', () => { throw new Error('the hook blew up'); }).then(() => assert.fail('answered'), (error) => error);
    assert.ok(failure instanceof EnvironmentError, String(failure));
    assert.match(failure.message, /the DevTools command Foo\\.bar did not answer within 0\\.03 s/);
    assert.match(failure.message, /the hook blew up/);
    assert.ok(Date.now() - started < 5000, 'the wait hung');
  `);
});

test('a stylesheet that could close the style element ("</style", any case, any spacing after it) is refused with an Error naming it; plain CSS is wrapped as is', () => {
  inChild(`
    assert.equal(inlineStyle('.a { color: red; }'), '<style>.a { color: red; }</style>');
    for (const bad of ['.a{}</style><script>alert(1)</script>', '.a{}</STYLE >', '.a{}</Style\\n>', 'x</style']) {
      assert.throws(() => inlineStyle(bad), (error) => error instanceof Error && /<\\/style/.test(error.message) && /stylesheet/.test(error.message), bad);
    }
  `);
});
