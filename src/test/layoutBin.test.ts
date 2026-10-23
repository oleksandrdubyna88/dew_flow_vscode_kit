import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, test } from 'node:test';
import type { TestContext } from 'node:test';

/**
 * The layout bin, `vscode-webview-kit-layout-check` (`todo/PLAN_layout_check_bin.md`, story E18.K2): it checks a
 * consumer's OWN page file in a real headless Chrome. These tests run the bin the way a consumer meets it - from an
 * installed layout (`scripts/layout/*.mjs` beside a `dist/layout/` built by `scripts/build-layout.mjs`) - over planted
 * pages in `src/test/fixtures/layout/`, so a missing browser is a failed test, never a skip. Each run gets a fresh
 * TEMP folder: the bin's profile lives there, and it must be empty again when the bin exits.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURES = path.join(ROOT, 'src', 'test', 'fixtures', 'layout');
const NARROW = ['--widths', '300', '--themes', 'dark', '--sizes', 'default'] as const;

let installed = '';
let bin = '';

before(() => {
  installed = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-layout-bin-'));
  fs.cpSync(path.join(ROOT, 'scripts', 'layout'), path.join(installed, 'scripts', 'layout'), { recursive: true });
  const built = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-layout.mjs'), '--out', path.join(installed, 'dist', 'layout')], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  bin = path.join(installed, 'scripts', 'layout', 'check.mjs');
});

after(() => {
  removeQuietly(installed);
});

interface Ran {
  readonly status: number | null;
  readonly said: string;
  readonly temp: string;
  readonly profile: string;
}

const page = (name: string): string => path.join(FIXTURES, name);

/**
 * Removes the test's own scaffolding. A folder Windows has just been told about can answer EPERM for a moment (the
 * search indexer, the antivirus), so it is retried; a folder that stays busy is the test machine's, not a result.
 */
function removeQuietly(folder: string): void {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(folder, { recursive: true, force: true });

      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }
}

/** The processes whose command line mentions `needle` - the bin's profile path, so only this run's browser tree can match. */
function processesMentioning(needle: string): string[] {
  if (process.platform === 'win32') {
    const script = 'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:KIT_NEEDLE) } | ForEach-Object { $_.ProcessId }';
    const ran = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 90_000, env: { ...process.env, KIT_NEEDLE: needle } });
    assert.equal(ran.status, 0, `could not list processes: ${ran.stderr}`);

    return ran.stdout.split(/\r?\n/).filter((line) => line.trim() !== '');
  }
  const ran = spawnSync('pgrep', ['-f', '--', needle], { encoding: 'utf8', timeout: 30_000 });

  return ran.status === 0 ? ran.stdout.split('\n').filter((line) => line.trim() !== '') : [];
}

/**
 * The processes still mentioning `needle` once they have had `graceMs` to finish ending. A process the kill has just ended
 * can still be listed for a while on a loaded Windows machine (Chrome's crash handler took up to 40 s, measured), so a
 * list that is empty by the deadline passes and one that is not is a real leak.
 */
function processesGoneWithin(needle: string, graceMs: number): string[] {
  const deadline = Date.now() + graceMs;
  let left = processesMentioning(needle);
  while (left.length > 0 && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2_000);
    left = processesMentioning(needle);
  }

  return left;
}

/** After a run: its temp folder is empty (profile removed) and no process of its browser tree is left. */
function assertCleanedUp(ran: Ran): void {
  assert.deepEqual(fs.readdirSync(ran.temp), [], `the bin left files in its temp folder: ${ran.said}`);
  if (ran.profile !== '') {
    assert.deepEqual(processesGoneWithin(ran.profile, 60_000), [], `a process of the bin's Chrome (profile ${ran.profile}) is still running`);
  }
}

function run(args: readonly string[], env: NodeJS.ProcessEnv = {}, options: { readonly clean?: boolean } = {}): Ran {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-layout-run-'));
  const ran = spawnSync(process.execPath, [bin, ...args], { cwd: installed, encoding: 'utf8', timeout: 240_000, env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp, ...env } });
  assert.equal(ran.error, undefined, `could not run: ${String(ran.error)}`);
  const said = `${ran.stdout}${ran.stderr}`;
  const result: Ran = { status: ran.status, said, temp, profile: /^layout-check: profile (.+)$/m.exec(said)?.[1]?.trim() ?? '' };
  try {
    if (options.clean ?? true) {
      assertCleanedUp(result);
    }
  } finally {
    removeQuietly(temp);
  }

  return result;
}

// ---- RED 1 and 2: the checks of the gallery, over a consumer's page ----------------------------------------------------

test('a table wider than its box at 300 px: exit 1, naming the page, the width, the table - and the JSON report says the same', { timeout: 300_000 }, () => {
  const report = path.join(os.tmpdir(), `kit-layout-json-${process.pid}.json`);
  try {
    const ran = run(['--page', page('table-wide.html'), ...NARROW, '--json', report]);

    assert.equal(ran.status, 1, ran.said);
    assert.match(ran.said, /FAIL .*table-wide\.html 300 dark default table.*wide/, ran.said);
    const json = JSON.parse(fs.readFileSync(report, 'utf8')) as { findings: { page: string; width: number; theme: string; size: string; where: string; problem: string }[] };
    assert.ok(json.findings.length > 0, 'the JSON report has no findings');
    assert.deepEqual([json.findings[0]?.width, json.findings[0]?.theme, json.findings[0]?.size], [300, 'dark', 'default']);
    assert.match(json.findings[0]?.page ?? '', /table-wide\.html$/);
  } finally {
    fs.rmSync(report, { force: true });
  }
});

test('a page that fits passes: exit 0 at all three widths, in all four themes and three sizes', { timeout: 300_000 }, () => {
  const ran = run(['--page', page('ok.html')]);

  assert.equal(ran.status, 0, ran.said);
});

test('a page wider than the window: exit 1, "the page scrolls sideways"', { timeout: 300_000 }, () => {
  const ran = run(['--page', page('page-wide.html'), ...NARROW]);

  assert.equal(ran.status, 1, ran.said);
  assert.match(ran.said, /the page scrolls sideways/, ran.said);
});

test('the theme class is applied: a rule only under .vscode-light is a defect in light and not in dark', { timeout: 300_000 }, () => {
  const dark = run(['--page', page('theme-light-only.html'), '--widths', '300', '--themes', 'dark', '--sizes', 'default']);
  const light = run(['--page', page('theme-light-only.html'), '--widths', '300', '--themes', 'light', '--sizes', 'default']);

  assert.equal(dark.status, 0, dark.said);
  assert.equal(light.status, 1, light.said);
  assert.match(light.said, /300 light default/, light.said);
});

// ---- RED 3: --rows ----------------------------------------------------------------------------------------------

test('--rows: two cards in one row with different heights fail, naming both heights', { timeout: 300_000 }, () => {
  const ran = run(['--page', page('rows-unequal.html'), '--rows', '.card', ...NARROW]);

  assert.equal(ran.status, 1, ran.said);
  assert.match(ran.said, /62px.*92px|92px.*62px/, ran.said);
});

test('--rows: equal heights in a row pass, and cards on different rows with different heights pass', { timeout: 300_000 }, () => {
  const ran = run(['--page', page('rows-equal.html'), '--page', page('rows-stacked.html'), '--rows', '.card', ...NARROW]);

  assert.equal(ran.status, 0, ran.said);
});

test('--rows groups by a 2 px tolerance, not a rounded top: tops 100.49 and 100.51 are one row', { timeout: 300_000 }, () => {
  const ran = run(['--page', page('rows-subpixel.html'), '--rows', '.card', ...NARROW]);

  assert.equal(ran.status, 1, ran.said);
  assert.match(ran.said, /60px.*90px|90px.*60px|62px.*92px|92px.*62px/, ran.said);
});

test('without --rows the rows check does not run: unequal cards pass', { timeout: 300_000 }, () => {
  const ran = run(['--page', page('rows-unequal.html'), ...NARROW]);

  assert.equal(ran.status, 0, ran.said);
});

// ---- RED 4: --single-line ---------------------------------------------------------------------------------------

test('--single-line: a cell whose text wraps at 300 px fails; one that fits passes; one tall line passes', { timeout: 300_000 }, () => {
  const wraps = run(['--page', page('single-wrap.html'), '--single-line', '.pid', ...NARROW]);
  const fits = run(['--page', page('single-fit.html'), '--page', page('single-tall.html'), '--single-line', '.pid', ...NARROW]);

  assert.equal(wraps.status, 1, wraps.said);
  assert.match(wraps.said, /single-wrap\.html.*span\.pid/, wraps.said);
  assert.equal(fits.status, 0, fits.said);
});

test('--single-line is judged on the text\'s line boxes: a flex container whose text wraps fails, an inline element with a badge child passes', { timeout: 300_000 }, () => {
  const flex = run(['--page', page('single-flex.html'), '--single-line', '.pid', ...NARROW]);
  const badge = run(['--page', page('single-badge.html'), '--single-line', '.pid', ...NARROW]);

  assert.equal(flex.status, 1, flex.said);
  assert.equal(badge.status, 0, badge.said);
});

// ---- RED 5: the box ---------------------------------------------------------------------------------------------

test('a page that asks for the network and for a file outside its folder: exit 1 naming each request (a link, an image, a fetch, a ../ stylesheet)', { timeout: 300_000 }, () => {
  const ran = run(['--page', page(path.join('net', 'network.html')), ...NARROW]);

  assert.equal(ran.status, 1, ran.said);
  for (const asked of ['https://example.invalid/x.css', 'https://example.invalid/pic.png', 'https://example.invalid/data.json', 'outside.css']) {
    assert.match(ran.said, new RegExp(`asked for .*${asked.replace(/[.\\/]/g, '\\$&')}`), `no "asked for" naming ${asked}: ${ran.said}`);
  }
});

test('no request leaves the machine: a loopback server asked by the page sees nothing', { timeout: 300_000 }, async (t) => {
  const hits: string[] = [];
  const server = http.createServer((request, response) => { hits.push(request.url ?? ''); response.end('body { color: red; }'); });
  await new Promise<void>((done) => { server.listen(0, '127.0.0.1', done); });
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-layout-loopback-'));
  try {
    const { port } = server.address() as { port: number };
    fs.writeFileSync(path.join(folder, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>t</title><link rel="stylesheet" href="http://127.0.0.1:${port}/x.css"></head><body><img src="http://127.0.0.1:${port}/y.png" alt=""><script>fetch('http://127.0.0.1:${port}/z.json').catch(function () {});</script></body></html>`);
    const ran = await runAsync(['--page', path.join(folder, 'index.html'), ...NARROW]);

    assert.equal(ran.status, 1, ran.said);
    assert.match(ran.said, new RegExp(`asked for .*127\\.0\\.0\\.1:${port}/x\\.css`), ran.said);
    assert.deepEqual(hits, [], 'the page reached a server');
  } finally {
    server.close();
    removeQuietly(folder);
    t.diagnostic('loopback server closed');
  }
});

/** `run` without blocking this process's event loop, so a server in the same process can answer (or fail to). */
function runAsync(args: readonly string[]): Promise<{ status: number | null; said: string }> {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-layout-run-'));

  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd: installed, env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp } });
    let said = '';
    child.stdout.on('data', (chunk: Buffer) => { said += String(chunk); });
    child.stderr.on('data', (chunk: Buffer) => { said += String(chunk); });
    child.on('error', fail);
    child.on('close', (status) => {
      removeQuietly(temp);
      done({ status, said });
    });
  });
}

test('a symlink inside the page folder that points outside it is refused (real-path containment)', { timeout: 300_000 }, (t: TestContext) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-layout-link-'));
  try {
    fs.mkdirSync(path.join(base, 'site'));
    fs.mkdirSync(path.join(base, 'outside'));
    fs.writeFileSync(path.join(base, 'outside', 'secret.css'), 'body { color: red; }');
    fs.writeFileSync(path.join(base, 'site', 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>t</title><link rel="stylesheet" href="link/secret.css"></head><body>x</body></html>');
    try {
      fs.symlinkSync(path.join(base, 'outside'), path.join(base, 'site', 'link'), 'junction');
    } catch (error) {
      t.skip(`this OS refused to create a link (${String(error)}); the containment is checked by real path on every OS that can`);

      return;
    }
    const ran = run(['--page', path.join(base, 'site', 'index.html'), ...NARROW]);

    assert.equal(ran.status, 1, ran.said);
    assert.match(ran.said, /asked for .*secret\.css/, ran.said);
  } finally {
    removeQuietly(base);
  }
});

test('a page folder with a space and non-ASCII characters loads its own stylesheet and script: no false "asked for"', { timeout: 300_000 }, () => {
  const ran = run(['--page', page(path.join('with space é ü', 'page.html')), ...NARROW]);

  assert.doesNotMatch(ran.said, /asked for/, ran.said);
  assert.equal(ran.status, 1, ran.said);
  assert.match(ran.said, /scrolls sideways/, `the stylesheet of the folder did not load: ${ran.said}`);
});

// ---- the deadlines and the clean-up -----------------------------------------------------------------------------

test('a page whose script never yields: exit 3 within the bound, naming it, and no Chrome and no profile of this run is left', { timeout: 300_000 }, () => {
  const started = Date.now();
  const ran = run(['--page', page('loop.html'), ...NARROW], { KIT_LAYOUT_NAV_MS: '4000', KIT_LAYOUT_PROBE_MS: '4000' });

  assert.equal(ran.status, 3, ran.said);
  assert.match(ran.said, /did not (finish|answer) within/, ran.said);
  assert.ok(Date.now() - started < 85_000, 'the run was not cut at the bound (navigation alone defaults to 90 s)');
});

test('a normal run leaves no process of its browser tree and an empty temp folder', { timeout: 300_000 }, () => {
  const ran = run(['--page', page('ok.html'), ...NARROW]);

  assert.equal(ran.status, 0, ran.said);
  assert.notEqual(ran.profile, '', `the bin did not print its profile folder: ${ran.said}`);
});

test('SIGTERM stops the browser tree and removes the profile (POSIX; Windows cannot deliver a catchable signal to a child)', { timeout: 300_000 }, async (t: TestContext) => {
  if (process.platform === 'win32') {
    t.skip('Windows terminates a child on any signal without running its handlers; the handler is unit-tested in layoutCheck.test.ts');

    return;
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-layout-run-'));
  const child = spawn(process.execPath, [bin, '--page', page('ok.html'), '--widths', '300,1280,1920', '--sizes', 'small,default,large'], { cwd: installed, env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp } });
  let said = '';
  const profile = new Promise<string>((done) => { child.stdout.on('data', (chunk: Buffer) => { said += String(chunk); const found = /^layout-check: profile (.+)$/m.exec(said); if (found?.[1]) { done(found[1].trim()); } }); });
  const closed = new Promise<void>((done) => { child.on('close', () => { done(); }); });
  const folder = await profile;
  child.kill('SIGTERM');
  await closed;
  try {
    assert.deepEqual(fs.readdirSync(temp), [], `the profile was left: ${said}`);
    assert.deepEqual(processesGoneWithin(folder, 60_000), [], 'a process of the bin\'s Chrome is still running');
  } finally {
    removeQuietly(temp);
  }
});

// ---- RED 6: usage and the environment ---------------------------------------------------------------------------

const USAGE_CASES: readonly (readonly [string, readonly string[], RegExp])[] = [
  ['no --page', [], /needs at least one --page/],
  ['a page that does not exist', ['--page', path.join(FIXTURES, 'nope.html')], /nope\.html.*does not exist/],
  ['a directory for a page', ['--page', FIXTURES], /is not a file/],
  ['a page that is not .html', ['--page', page('outside.css')], /must end in \.html/],
  ['an unknown option', ['--page', page('ok.html'), '--everything'], /unknown option.*--everything/],
  ['a width below 200', ['--page', page('ok.html'), '--widths', '199'], /width.*200.*4000/],
  ['a width above 4000', ['--page', page('ok.html'), '--widths', '300,4001'], /width.*200.*4000/],
  ['a width that is not a number', ['--page', page('ok.html'), '--widths', 'wide'], /width.*200.*4000/],
  ['an unknown theme', ['--page', page('ok.html'), '--themes', 'dark,neon'], /unknown theme.*neon/],
  ['an unknown size', ['--page', page('ok.html'), '--sizes', 'huge'], /unknown size.*huge/],
  ['an empty --rows selector', ['--page', page('ok.html'), '--rows', ''], /--rows needs a non-empty CSS selector/],
  ['an empty --single-line selector', ['--page', page('ok.html'), '--single-line', '  '], /--single-line needs a non-empty CSS selector/],
];

for (const [name, args, sentence] of USAGE_CASES) {
  test(`usage: ${name} is exit 2 with its sentence, before any browser is looked for`, { timeout: 120_000 }, () => {
    // CHROME_PATH names nothing: if a browser were looked for first, the answer would be 3, never 2.
    const ran = run(args, { CHROME_PATH: path.join(os.tmpdir(), 'kit-no-such-chrome', 'chrome') });

    assert.equal(ran.status, 2, ran.said);
    assert.match(ran.said, sentence, ran.said);
    assert.match(ran.said, /usage: vscode-webview-kit-layout-check --page/, ran.said);
  });
}

test('a selector the browser cannot parse is a usage error (exit 2), not a pass', { timeout: 300_000 }, () => {
  const ran = run(['--page', page('ok.html'), '--rows', 'div[', ...NARROW]);

  assert.equal(ran.status, 2, ran.said);
  assert.match(ran.said, /--rows.*not a valid CSS selector/, ran.said);
});

test('a CHROME_PATH that names nothing is exit 3 saying so - never a pass, never another browser - and no profile is made', { timeout: 120_000 }, () => {
  const ran = run(['--page', page('ok.html')], { CHROME_PATH: path.join(os.tmpdir(), 'kit-no-such-chrome', 'chrome') });

  assert.equal(ran.status, 3, ran.said);
  assert.match(ran.said, /CHROME_PATH is set to .*kit-no-such-chrome.*which does not exist/, ran.said);
});

// ---- RED 7: one implementation ----------------------------------------------------------------------------------

test('the gallery check is a caller of the shared core: no DevTools client, no browser launch and no probe of its own', () => {
  const gallery = fs.readFileSync(path.join(ROOT, 'scripts', 'layout-check.mjs'), 'utf8');
  const pageBuilder = fs.readFileSync(path.join(ROOT, '.storybook', 'layout-page.ts'), 'utf8');

  assert.match(gallery, /from '\.\/layout\//, 'the gallery check does not import the core');
  assert.doesNotMatch(gallery, /new WebSocket|class Devtools|spawn\(|Emulation\.setDeviceMetricsOverride/, 'the gallery check carries its own copy of the browser driver');
  assert.doesNotMatch(pageBuilder, /scrollWidth|__kitLayout/, 'the gallery page carries its own probe');
  assert.equal(fs.existsSync(path.join(ROOT, 'scripts', 'lib', 'cleanup.mjs')), false, 'the clean-up helpers still live outside the shipped core');
  assert.equal(fs.existsSync(path.join(ROOT, 'scripts', 'layout', 'cleanup.mjs')), true);
});
