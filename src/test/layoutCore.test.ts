import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

/**
 * The pieces of the shared layout core (`scripts/layout/`) that decide something without a browser
 * (`todo/PLAN_layout_check_bin.md` §3, §9): the command line, the bounds on every wait, the judgement of a request against
 * the page's folder, the way a browser tree is ended, what a signal does, and the shape of the report. They are ES modules
 * outside the TypeScript program, so each case runs its body in a `node --input-type=module` child with the module
 * imported as `m`; a body that throws is a failed case, and its message is what the test prints. The browser itself is
 * `layoutBin.test.ts`.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const moduleUrl = (name: string): string => pathToFileURL(path.join(ROOT, 'scripts', 'layout', name)).href;

function inModule(name: string, body: string, env: NodeJS.ProcessEnv = {}): void {
  const code = ['import assert from "node:assert/strict";', 'const m = await import(process.env.KIT_MODULE);', body].join('\n');
  const ran = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, ...env, KIT_MODULE: moduleUrl(name) } });
  assert.equal(ran.error, undefined, `could not run: ${String(ran.error)}`);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
}

// ---- the command line -------------------------------------------------------------------------------------------

test('arguments: the defaults are the three widths, the four themes and the three sizes; a repeated value counts once; --help is not a run', () => {
  const page = path.join(ROOT, 'src', 'test', 'fixtures', 'layout', 'ok.html');
  inModule('args.mjs', `
    const one = m.parseArguments(['--page', ${JSON.stringify(page)}]);
    assert.deepEqual(one.widths, [300, 1280, 1920]);
    assert.deepEqual(one.themes, ['dark', 'light', 'high-contrast', 'high-contrast-light']);
    assert.deepEqual(one.sizes, ['small', 'default', 'large']);
    assert.equal(one.rows, undefined); assert.equal(one.singleLine, undefined); assert.equal(one.json, undefined);
    const two = m.parseArguments(['--page', ${JSON.stringify(page)}, '--widths', '300, 300 ,1280', '--themes', 'dark,dark', '--rows', ' .card ']);
    assert.deepEqual(two.widths, [300, 1280]); assert.deepEqual(two.themes, ['dark']); assert.equal(two.rows, '.card');
    assert.deepEqual(m.parseArguments(['--help']), { help: true });
    assert.equal(m.THEMES.get('dark'), 'vscode-dark'); assert.equal(m.SIZES.get('large'), 18);
  `);
});

test('arguments: a positional argument and a missing option value are usage errors, and the page label is what the user typed', () => {
  const page = path.join(ROOT, 'src', 'test', 'fixtures', 'layout', 'ok.html');
  inModule('args.mjs', `
    assert.throws(() => m.parseArguments(['--page', ${JSON.stringify(page)}, 'extra']), (e) => e instanceof m.UsageError && /unexpected argument extra/.test(e.message));
    assert.throws(() => m.parseArguments(['--page']), (e) => e instanceof m.UsageError);
    assert.equal(m.parseArguments(['--page', ${JSON.stringify(page)}]).pages[0].label, ${JSON.stringify(page)});
  `);
});

// ---- the bounds -------------------------------------------------------------------------------------------------

test('deadlines: every bound has a default and a variable that lowers it; a value that is not a whole number of at least 1 is ignored', () => {
  inModule('deadlines.mjs', `
    const fresh = m.deadlines({});
    assert.deepEqual(Object.keys(fresh).sort(), ['commandMs', 'connectMs', 'navigationMs', 'probeMs', 'startMs']);
    assert.ok(Object.values(fresh).every((ms) => Number.isInteger(ms) && ms >= 1000));
    const cut = m.deadlines({ KIT_LAYOUT_NAV_MS: '4000', KIT_LAYOUT_PROBE_MS: '1500', KIT_LAYOUT_START_MS: '9000', KIT_LAYOUT_CONNECT_MS: '2000', KIT_LAYOUT_COMMAND_MS: '3000' });
    assert.deepEqual(cut, { startMs: 9000, connectMs: 2000, commandMs: 3000, navigationMs: 4000, probeMs: 1500 });
    for (const bad of ['0', '-5', '1.5', 'abc', '', '12ms', ' 7']) {
      assert.deepEqual(m.deadlines({ KIT_LAYOUT_NAV_MS: bad }), fresh, 'accepted ' + JSON.stringify(bad));
    }
  `);
});

// ---- the box ----------------------------------------------------------------------------------------------------

function layout(): { readonly base: string; readonly folder: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-netbox-'));
  const folder = path.join(base, 'page folder é');
  fs.mkdirSync(path.join(folder, 'sub'), { recursive: true });
  fs.mkdirSync(path.join(base, 'outside'));
  fs.writeFileSync(path.join(folder, 'index.html'), 'x');
  fs.writeFileSync(path.join(folder, 'sub', 'a.css'), 'x');
  fs.writeFileSync(path.join(base, 'outside', 'secret.css'), 'x');

  return { base, folder };
}

test('netbox: a file under the page\'s folder loads - encoded spaces and non-ASCII included, a file not there yet included; a sibling folder, a ../ climb and every network scheme do not', () => {
  const { base, folder } = layout();
  try {
    inModule('netbox.mjs', `
      const folder = m.boundaryOf(${JSON.stringify(path.join(folder, 'index.html'))});
      const url = (p) => new URL('file:///' + p.replace(/\\\\/g, '/').replace(/^\\//, '')).href;
      const inside = (rest) => url(${JSON.stringify(folder)} + '/' + rest);
      for (const rest of ['index.html', 'sub/a.css', 'sub/not-there-yet.css', 'sub/deeper/not-there/either.css']) {
        assert.equal(m.mayLoad(inside(rest), folder), true, rest);
      }
      assert.equal(m.mayLoad(url(${JSON.stringify(path.join(base, 'outside', 'secret.css'))}), folder), false, 'a sibling folder');
      assert.equal(m.mayLoad(inside('../outside/secret.css'), folder), false, 'a ../ climb');
      assert.equal(m.mayLoad(inside('sub/%2e%2e/%2e%2e/outside/secret.css'), folder), false, 'an encoded climb');
      for (const remote of ['https://example.invalid/x.css', 'http://127.0.0.1:1/x', 'ftp://example.invalid/x', 'ws://127.0.0.1:1/', 'blob:null/1', 'chrome://version', 'file://server/share/x.css', 'not a url', '']) {
        assert.equal(m.mayLoad(remote, folder), false, remote);
      }
      for (const inline of ['data:text/plain,hello', 'about:blank']) {
        assert.equal(m.mayLoad(inline, folder), true, inline);
      }
    `);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('netbox: a link or junction inside the page folder that points outside it is refused by its REAL path (skipped where the OS will not create one)', (t) => {
  const { base, folder } = layout();
  try {
    try {
      fs.symlinkSync(path.join(base, 'outside'), path.join(folder, 'link'), 'junction');
    } catch (error) {
      t.skip(`this OS refused to create a link: ${String(error)}`);

      return;
    }
    inModule('netbox.mjs', `
      const folder = m.boundaryOf(${JSON.stringify(path.join(folder, 'index.html'))});
      const through = new URL('file:///' + ${JSON.stringify(path.join(folder, 'link', 'secret.css'))}.replace(/\\\\/g, '/').replace(/^\\//, '')).href;
      assert.equal(m.mayLoad(through, folder), false, 'a request through the link reached a file outside the folder');
    `);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('netbox: on Windows the comparison ignores case and is drive-letter aware', (t) => {
  if (process.platform !== 'win32') {
    t.skip('only Windows paths are case-insensitive and have drive letters');

    return;
  }
  const { base, folder } = layout();
  try {
    inModule('netbox.mjs', `
      const folder = m.boundaryOf(${JSON.stringify(path.join(folder, 'index.html'))});
      const shouted = new URL('file:///' + ${JSON.stringify(path.join(folder, 'sub', 'a.css'))}.replace(/\\\\/g, '/').toUpperCase()).href;
      assert.equal(m.mayLoad(shouted, folder), true, 'the same file in another case');
      const other = folder.startsWith('C:') ? 'D:' : 'C:';
      assert.equal(m.mayLoad('file:///' + other + '/anything/a.css', folder), false, 'another drive');
    `);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---- ending the browser -----------------------------------------------------------------------------------------

test('endBrowser: Windows ends the tree of the PID with taskkill /T /F; elsewhere the process GROUP is signalled, and the child itself when the group is gone; nothing without a PID', () => {
  inModule('browser.mjs', `
    const calls = [];
    const child = { pid: 4242, kill: (signal) => calls.push(['child.kill', signal]) };
    m.endBrowser(child, { platform: 'win32', run: (...args) => { calls.push(['run', ...args]); }, killGroup: () => assert.fail('a group kill on Windows') });
    assert.deepEqual(calls, [['run', 'taskkill', ['/PID', '4242', '/T', '/F'], { stdio: 'ignore', timeout: 30000 }]]);
    calls.length = 0;
    m.endBrowser(child, { platform: 'linux', run: () => assert.fail('taskkill on Linux'), killGroup: (pid, signal) => calls.push(['group', pid, signal]) });
    assert.deepEqual(calls, [['group', 4242, 'SIGKILL']]);
    calls.length = 0;
    m.endBrowser(child, { platform: 'linux', run: () => undefined, killGroup: () => { throw Object.assign(new Error('no group'), { code: 'ESRCH' }); } });
    assert.deepEqual(calls, [['child.kill', 'SIGKILL']]);
    calls.length = 0;
    m.endBrowser({ pid: undefined, kill: () => assert.fail('killed a process that never started') }, { platform: 'linux', run: () => assert.fail('x'), killGroup: () => assert.fail('x') });
  `);
});

test('chromeArgs: the network is shut at the browser (dead proxy loopback does not bypass, WebRTC proxied only, no background networking), file access is not widened, and --no-sandbox is Linux only', () => {
  inModule('browser.mjs', `
    const linux = m.chromeArgs('/profile', 'linux');
    const win = m.chromeArgs('C:\\\\profile', 'win32');
    for (const flag of ['--proxy-server=127.0.0.1:9', '--proxy-bypass-list=<-loopback>', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--disable-background-networking', '--headless=new', '--user-data-dir=/profile']) {
      assert.ok(linux.includes(flag), 'missing ' + flag);
    }
    assert.ok(!linux.some((flag) => flag.startsWith('--allow-file-access')), 'file access was widened');
    assert.ok(linux.includes('--no-sandbox')); assert.ok(!win.includes('--no-sandbox'));
  `);
});

test('findChrome: a CHROME_PATH that names nothing is an EnvironmentError and never a fallback; one that exists is used; on Linux nothing on PATH is an error naming CHROME_PATH', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-no-chrome-'));
  const file = path.join(empty, 'chrome');
  fs.writeFileSync(file, '');
  try {
    inModule('browser.mjs', `
      const cleanup = await import(${JSON.stringify(moduleUrl('cleanup.mjs'))});
      assert.throws(() => m.findChrome({ CHROME_PATH: ${JSON.stringify(path.join(empty, 'missing'))} }, 'win32'), (e) => e instanceof cleanup.EnvironmentError && /CHROME_PATH is set to .*missing.*which does not exist/.test(e.message));
      assert.equal(m.findChrome({ CHROME_PATH: ${JSON.stringify(file)} }, 'win32'), ${JSON.stringify(file)});
      assert.throws(() => m.findChrome({ PATH: ${JSON.stringify(empty)} }, 'linux'), (e) => e instanceof cleanup.EnvironmentError && /no Chrome found: set CHROME_PATH/.test(e.message));
    `);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

// ---- signals ----------------------------------------------------------------------------------------------------

test('cleanOnSignals: SIGINT and SIGTERM run the clean-up and only then exit with 128 + the signal; the handlers come off again; a clean-up that throws still exits', () => {
  inModule('browser.mjs', `
    const { EventEmitter } = await import('node:events');
    const order = [];
    const proc = new EventEmitter();
    const exit = (code) => order.push('exit ' + code);
    const release = m.cleanOnSignals(async () => { order.push('cleanup start'); await new Promise((done) => setTimeout(done, 20)); order.push('cleanup end'); }, { proc, exit });
    proc.emit('SIGTERM');
    await new Promise((done) => setTimeout(done, 100));
    assert.deepEqual(order, ['cleanup start', 'cleanup end', 'exit 143']);
    order.length = 0;
    proc.emit('SIGINT');
    await new Promise((done) => setTimeout(done, 100));
    assert.deepEqual(order, ['cleanup start', 'cleanup end', 'exit 130']);
    release();
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) { assert.equal(proc.listenerCount(signal), 0, signal); }
    const failing = new EventEmitter(); const codes = [];
    m.cleanOnSignals(() => { throw new Error('busy'); }, { proc: failing, exit: (code) => codes.push(code) });
    failing.emit('SIGHUP');
    await new Promise((done) => setTimeout(done, 50));
    assert.deepEqual(codes, [129]);
  `);
});

// ---- the report -------------------------------------------------------------------------------------------------

test('report: a defect is one FAIL line - page, width, theme, size, what - with a dash where it belongs to no state; at most `limit` lines, the rest counted', () => {
  inModule('report.mjs', `
    const state = { page: 'a.html', width: 300, theme: 'dark', size: 'default', group: '', where: 'table.x', problem: 'is 500px wide in 284px' };
    assert.equal(m.failLine(state), 'FAIL a.html 300 dark default table.x is 500px wide in 284px');
    assert.equal(m.failLine({ ...state, group: 'dataTable/eight [box]' }), 'FAIL a.html 300 dark default [dataTable/eight [box]] table.x is 500px wide in 284px');
    assert.equal(m.failLine({ page: 'a.html', width: null, theme: null, size: null, group: '', where: 'the page', problem: 'asked for https://x/y.css' }), 'FAIL a.html - - - the page asked for https://x/y.css');
    const many = Array.from({ length: 5 }, () => state);
    assert.equal(m.failLines(many, 3).length, 4);
    assert.match(m.failLines(many, 3)[3], /and 2 more/);
    assert.equal(m.failLines(many).length, 5);
    assert.match(m.verdict([], 2, 36), /ok - 2 page\\(s\\), 36 state\\(s\\)/);
    assert.match(m.verdict(many, 2, 36), /RED - 5 defect\\(s\\) in 1 of 2 page\\(s\\)/);
  `);
});
