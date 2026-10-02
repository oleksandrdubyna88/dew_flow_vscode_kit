#!/usr/bin/env node
/**
 * Runs the fixture's BUNDLE under node with a `vscode` stub, and asserts that it worked:
 *
 *     node run.mjs dist/extension.js
 *
 * `scripts/pack-and-consume.mjs` calls this inside the temporary consumer, after esbuild bundled the fixture
 * against the INSTALLED package. The bundle is loaded with a `require` that answers `vscode` with the stub,
 * hands out node built-ins, and REFUSES anything else — so a bundle that still needs the kit (or anything) at
 * run time fails here, which is what "nothing from the package ships as a separate runtime dependency in a
 * .vsix" means.
 *
 * The stub has only what the fixture's adapters touch (`src/vscode.d.ts` declares the same members); reading
 * any other member throws, naming it. Configuration writes are recorded and fire the change event the way
 * VS Code's do; a panel records the HTML it was given and what was posted to it, and `receive` plays a
 * message the page posted, as a structured clone. Node built-ins only. Exit 0 and one `consumer-fixture: ok`
 * line on success; exit 1 and the failed assertion otherwise.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, isBuiltin } from 'node:module';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const DEADLINE_MS = 5_000;
const GLOBAL = 1;

/** An object whose missing members throw, naming the member — the stub stays exactly as wide as the fixture's use. */
function strict(name, members) {
  return new Proxy(members, {
    get(target, prop, receiver) {
      if (typeof prop === 'symbol' || prop in target) {
        return Reflect.get(target, prop, receiver);
      }
      // What module interop and promise resolution probe for; absent, as on the real namespace.
      if (prop === '__esModule' || prop === 'default' || prop === 'then') {
        return undefined;
      }
      throw new Error(`vscode stub: ${name}.${prop} is not stubbed — the fixture reached an API run.mjs does not provide`);
    },
  });
}

/** `vscode.Event<T>` with a live listener count. */
function emitter() {
  const listeners = new Set();
  return {
    event: (listener) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    fire: (value) => {
      for (const listener of [...listeners]) {
        listener(value);
      }
    },
    get size() {
      return listeners.size;
    },
  };
}

function makeStub() {
  const store = new Map();
  const writes = [];
  const changed = emitter();
  const panels = [];
  const commands = new Map();

  const configuration = (section) => strict('WorkspaceConfiguration', {
    get: (key) => store.get(`${section}.${key}`),
    update: (key, value, target) => {
      const name = `${section}.${key}`;
      writes.push({ setting: name, value, target });
      store.set(name, value);
      changed.fire({ affectsConfiguration: (asked) => asked === name || name.startsWith(`${asked}.`) });
      return Promise.resolve();
    },
  });

  const vscode = strict('vscode', {
    ConfigurationTarget: strict('ConfigurationTarget', { Global: GLOBAL, Workspace: 2, WorkspaceFolder: 3 }),
    ViewColumn: strict('ViewColumn', { Active: -1, Beside: -2, One: 1 }),
    workspace: strict('workspace', { getConfiguration: configuration, onDidChangeConfiguration: changed.event }),
    window: strict('window', {
      createWebviewPanel: (viewType, title, column, options) => {
        const panel = makePanel({ viewType, title, column, options });
        panels.push(panel);
        return panel.api;
      },
    }),
    commands: strict('commands', {
      registerCommand: (id, callback) => {
        assert.equal(commands.has(id), false, `command ${id} registered twice`);
        commands.set(id, callback);
        return { dispose: () => commands.delete(id) };
      },
    }),
  });

  return { vscode, writes, changed, panels, commands };
}

function makePanel(created) {
  const received = emitter();
  const disposed = emitter();
  const posted = [];
  const htmls = [];
  let alive = true;
  let html = '';

  const webview = strict('Webview', {
    get html() {
      return html;
    },
    set html(value) {
      assert.ok(alive, 'HTML set on a disposed panel');
      html = value;
      htmls.push(value);
    },
    postMessage: (message) => {
      if (!alive) {
        return Promise.resolve(false);
      }
      posted.push(structuredClone(message));
      return Promise.resolve(true);
    },
    onDidReceiveMessage: received.event,
  });
  const api = strict('WebviewPanel', {
    webview,
    onDidDispose: disposed.event,
    reveal: () => {},
    dispose: () => {
      if (alive) {
        alive = false;
        disposed.fire();
      }
    },
  });

  return {
    created,
    api,
    posted,
    htmls,
    receive: (message) => {
      assert.ok(received.size > 0, 'the page posted while nobody listened');
      received.fire(structuredClone(message));
    },
    get messageListeners() {
      return received.size;
    },
  };
}

/** Load a CommonJS bundle with `vscode` answered by the stub, node built-ins allowed, anything else refused. */
function loadBundle(file, vscode) {
  const nodeRequire = createRequire(file);
  const requireFor = (id) => {
    if (id === 'vscode') {
      return vscode;
    }
    if (isBuiltin(id)) {
      return nodeRequire(id);
    }
    throw new Error(`the bundle required ${JSON.stringify(id)} at run time: everything but vscode and node built-ins must be bundled in`);
  };
  const module = { exports: {} };
  const body = vm.compileFunction(readFileSync(file, 'utf8'), ['exports', 'require', 'module', '__filename', '__dirname'], { filename: file });
  body(module.exports, requireFor, module, file, dirname(file));

  return module.exports;
}

/** Wait, a macrotask at a time, until `condition()` holds; fail naming `what` at the deadline. */
async function until(condition, what) {
  const deadline = Date.now() + DEADLINE_MS;
  while (!condition()) {
    assert.ok(Date.now() < deadline, `timed out waiting until ${what}`);
    await new Promise((done) => setImmediate(done));
  }
}

/** A few macrotasks, for asserting that something did NOT happen. */
async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await new Promise((done) => setImmediate(done));
  }
}

function nonceOf(html) {
  const csp = /<meta http-equiv="Content-Security-Policy"\s+content="default-src 'none'; [^"]*script-src 'nonce-([A-Za-z0-9_-]{22,})';">/.exec(html);
  assert.ok(csp, 'the help page carries no default-src none CSP with a script nonce');
  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((match) => match[1]);
  assert.deepEqual(scripts, [` nonce="${csp[1]}"`], 'the page should have exactly one script, carrying the CSP nonce');

  return csp[1];
}

const lastOf = (posted, type) => posted.filter((message) => message.type === type).at(-1);

async function helpPanelFlow(stub, ext) {
  const { writes, panels, commands } = stub;
  commands.get('kitFixture.showHelp')();
  assert.equal(panels.length, 1, 'showHelp made no panel');
  const panel = panels[0];
  assert.equal(panel.htmls.length, 1, 'the help page was not rendered on open');
  const first = nonceOf(panel.htmls[0]);
  assert.ok(panel.htmls[0].includes('Install the fixture'), 'the English article is not on the page');
  assert.ok(panel.htmls[0].includes('appendix &lt;for&gt; the fixture'), 'the consumer appendix is not on the page');
  await until(() => lastOf(panel.posted, 'uiScale') && lastOf(panel.posted, 'textTone'), 'the attached page was pushed its size and tone');
  const before = lastOf(panel.posted, 'uiScale');

  // A press the page posts: validated, clamped, written ONCE to the user scope, pushed back live.
  panel.receive({ type: 'zoom', delta: 1, field: '' });
  await until(() => writes.length === 1, 'the press was written');
  assert.deepEqual(writes[0], { setting: 'kitFixture.uiScale', value: 1, target: GLOBAL });
  await until(() => lastOf(panel.posted, 'uiScale') !== before, 'the new size was pushed to the page');
  assert.ok(lastOf(panel.posted, 'uiScale').px > before.px, 'the pushed size did not grow');

  // What the host must refuse: nothing is written.
  panel.receive({ type: 'zoom', delta: 'big', field: '' });
  panel.receive({ type: 'paint', delta: 1 });
  panel.receive({ type: 'language', language: 'fr', field: '' });
  await settle();
  assert.equal(writes.length, 1, `a refused message was written: ${JSON.stringify(writes.slice(1))}`);

  // A language the catalog offers: written, and the page re-rendered in it under a fresh nonce.
  panel.receive({ type: 'language', language: 'uk', field: '' });
  await until(() => writes.length === 2, 'the language was written');
  assert.deepEqual(writes[1], { setting: 'kitFixture.helpLanguage', value: 'uk', target: GLOBAL });
  await until(() => panel.htmls.length === 2, 'the page was re-rendered in the new language');
  assert.ok(panel.htmls[1].includes('Встановлення фікстури'), 'the re-rendered page is not in Ukrainian');
  assert.notEqual(nonceOf(panel.htmls[1]), first, 'a re-render reused the nonce');
  assert.ok(ext.helpPageHtml('uk').includes('Встановлення фікстури'), 'renderHelpPage did not render the translation');

  return panel;
}

function escaperFlow(ext) {
  const page = ext.statusHtml('</script><b>x</b>', { note: '</script><!--' });
  assert.ok(page.includes('<h1>&lt;/script&gt;&lt;b&gt;x&lt;/b&gt;</h1>'), 'escapeHtml did not escape the title');
  assert.ok(page.includes('{"note":"\\u003c/script>\\u003c!--"}'), 'jsonForScript did not escape the script data');
  assert.equal(page.split('</script>').length, 2, 'a value broke out of the script element');
  assert.match(page, /<script nonce="[A-Za-z0-9_-]{22}">/, 'nonce() did not mint a 22-character base64url nonce');
}

function lifetimeFlow(stub, ext, context, panel) {
  panel.api.dispose();
  assert.equal(panel.messageListeners, 0, 'the help panel kept its message listener after the panel closed');
  ext.deactivate();
  for (const subscription of context.subscriptions) {
    subscription.dispose();
  }
  assert.equal(stub.changed.size, 0, 'configuration listeners outlived deactivate');
  assert.equal(stub.commands.size, 0, 'a command outlived its subscription');
}

async function main() {
  const file = process.argv[2];
  assert.ok(file !== undefined, 'usage: node run.mjs <bundle>');
  const stub = makeStub();
  const ext = loadBundle(resolve(file), stub.vscode);
  assert.equal(typeof ext.activate, 'function', 'the bundle exports no activate');
  const context = { subscriptions: [] };
  ext.activate(context);
  const panel = await helpPanelFlow(stub, ext);
  escaperFlow(ext);
  assert.deepEqual(ext.notices, [], 'a reporter was told something on the happy path');
  lifetimeFlow(stub, ext, context, panel);
  process.stdout.write(`consumer-fixture: ok — help page rendered under a CSP nonce, ${stub.writes.length} setting write(s) through the stub, refused messages wrote nothing, escapers held, every listener unhooked\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`consumer-fixture: FAILED: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}
