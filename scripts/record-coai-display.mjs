#!/usr/bin/env node
/**
 * Re-records `src/test/fixtures/coai-display-1056aed9.json` from ConnectOtherAIs' OWN modules.
 *
 * <p>The byte-compatibility tests compare the kit against values the reference implementation COMPUTED,
 * never against literals somebody retyped (the family's testing rule: a value the code computes is read
 * back from the function that computes it). This script is how that fixture was made, so anyone can redo
 * it and diff.</p>
 *
 * Usage, from this repository's root, with a ConnectOtherAIs checkout beside it:
 *   node scripts/record-coai-display.mjs <path-to-dew_flow_connect_other_ais> [ref=1056aed9]
 *
 * It extracts the source files at `ref` with `git show`, compiles them with this repository's own
 * TypeScript into a temporary directory, runs them over a fixed set of inputs and prints the JSON.
 *
 * <p><b>The host halves too</b> (E2.S1). `uiScaleHost.ts` and `textToneHost.ts` import `vscode`, so they
 * are compiled and run against a STUB of the three things they touch — `workspace.getConfiguration`,
 * `workspace.onDidChangeConfiguration`, `ConfigurationTarget` — written into the temporary directory's
 * own `node_modules/vscode`. What is recorded is what they POST to a webview for a stored offset and what
 * they WRITE for a press: the message shapes the kit's host must reproduce byte for byte.</p>
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [coai, ref = '1056aed9'] = process.argv.slice(2);
if (!coai) {
  process.stderr.write('usage: node scripts/record-coai-display.mjs <coai checkout> [ref]\n');
  process.exit(64);
}

/** The pure modules the first recording covered, and the host halves with the queue they share. */
const PURE = ['asText', 'webviewHtml', 'zoomControl', 'textTone'];
const HOST = ['writeQueue', 'uiScaleHost', 'textToneHost'];

const OFFSETS = [-7, -5, -3, -1, 0, 1, 2, 3, 5, 9];
const CLAMP_INPUTS = [null, 'x', 2.9, -2.9, Infinity, NaN];
/** `[stored value, delta]` pairs a press is applied to — junk stored values and out-of-range deltas included. */
const PRESSES = [[0, 1], [0, -1], [4, 1], [5, 1], [-4, -1], [-5, -1], [2, 99], [2, -99], [2, 0.5], [3, 0], ['x', 1], [null, -1], [2.9, 1]];

/**
 * The `vscode` stub: one stored value per `section.key`, every `update` recorded with its target, and a
 * change listener that is handed back a disposable and never called — the hosts' own change handling is
 * not what is being recorded, their output is.
 */
const VSCODE_STUB_JS = `'use strict';
const stored = new Map();
const writes = [];
const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
const workspace = {
  getConfiguration(section) {
    return {
      get: (key) => stored.get(section + '.' + key),
      update: async (key, value, target) => {
        writes.push({ section, key, value, target });
        stored.set(section + '.' + key, value);
      },
    };
  },
  onDidChangeConfiguration() { return { dispose() {} }; },
};
module.exports = {
  ConfigurationTarget,
  workspace,
  __store(section, key, value) { stored.set(section + '.' + key, value); },
  __takeWrites() { return writes.splice(0); },
};
`;
// Typed, because TypeScript 6 compiles `strict` by default and an untyped stub makes every listener
// parameter an implicit `any` (TS7006). Only what the two host modules touch is declared.
const VSCODE_STUB_DTS = `export interface Disposable { dispose(): void; }
export interface Webview { postMessage(message: unknown): PromiseLike<boolean>; }
export interface ConfigurationChangeEvent { affectsConfiguration(section: string): boolean; }
export interface WorkspaceConfiguration {
  get(key: string): unknown;
  update(key: string, value: unknown, target?: number): Promise<void>;
}
export declare const workspace: {
  getConfiguration(section?: string): WorkspaceConfiguration;
  onDidChangeConfiguration(listener: (change: ConfigurationChangeEvent) => void): Disposable;
};
export declare const ConfigurationTarget: { Global: number; Workspace: number; WorkspaceFolder: number };
`;

const work = mkdtempSync(join(tmpdir(), 'kit-coai-'));
try {
  for (const name of [...PURE, ...HOST]) {
    const text = execFileSync('git', ['-C', coai, 'show', `${ref}:src_vs_code/src/${name}.ts`], { encoding: 'utf8' });
    writeFileSync(join(work, `${name}.ts`), text);
  }
  const stub = join(work, 'node_modules', 'vscode');
  mkdirSync(stub, { recursive: true });
  writeFileSync(join(stub, 'package.json'), JSON.stringify({ name: 'vscode', main: 'index.js', types: 'index.d.ts' }));
  writeFileSync(join(stub, 'index.js'), VSCODE_STUB_JS);
  writeFileSync(join(stub, 'index.d.ts'), VSCODE_STUB_DTS);

  // `--ignoreConfig`: TypeScript 6 refuses files on the command line while this repository's own
  // `tsconfig.json` is in the cwd, and that config (rootDir `src`, `noEmitOnError`) is not for these files.
  execFileSync(process.execPath, [
    join('node_modules', 'typescript', 'bin', 'tsc'),
    '--ignoreConfig', '--module', 'commonjs', '--target', 'ES2022', '--outDir', join(work, 'out'),
    ...[...PURE, ...HOST].map((n) => join(work, `${n}.ts`)),
  ], { stdio: 'inherit' });

  const require = createRequire(import.meta.url);
  const z = require(join(work, 'out', 'zoomControl.js'));
  const t = require(join(work, 'out', 'textTone.js'));
  const out = {
    source: `dew_flow_connect_other_ais@${ref} src_vs_code/src/{zoomControl,textTone,uiScaleHost,textToneHost}.ts`,
    zoom: {},
    tone: {},
  };
  for (const o of OFFSETS) {
    out.zoom[o] = { scalePx: z.scalePx(o), offsetLabel: z.offsetLabel(o), zoomControlHtml: z.zoomControlHtml(o), zoomStyle: z.zoomStyle(o) };
    out.tone[o] = {
      toneLabel: t.toneLabel(o),
      toneColour: t.toneColour(o),
      toneColourEditor: t.toneColour(o, 'var(--vscode-editor-foreground)'),
      toneStyle: t.toneStyle(o),
      toneControlHtml: t.toneControlHtml(o),
    };
  }
  out.zoomScript = z.zoomScript();
  out.ZOOM_CSS = z.ZOOM_CSS;
  out.toneScript = t.toneScript();
  out.TONE_CSS = t.TONE_CSS;
  out.clamp = {
    scale: CLAMP_INPUTS.map((v) => z.clampScale(v)),
    tone: CLAMP_INPUTS.map((v) => t.clampTone(v)),
  };

  // The host halves, through the stub. Section and keys are coai's own (`coai.uiScale`, `coai.textTone`).
  const vscode = require(join(stub, 'index.js'));
  const scaleHost = require(join(work, 'out', 'uiScaleHost.js'));
  const toneHost = require(join(work, 'out', 'textToneHost.js'));
  const targetName = (target) => Object.keys(vscode.ConfigurationTarget).find((k) => vscode.ConfigurationTarget[k] === target) ?? String(target);
  const firstPost = (push) => {
    const posted = [];
    const hook = push({ postMessage: (message) => { posted.push(message); return Promise.resolve(true); } });
    hook.dispose();
    if (posted.length !== 1) {
      throw new Error(`expected exactly one message on attach, got ${posted.length}`);
    }

    return posted[0];
  };
  out.host = { section: 'coai', keys: { uiScale: 'uiScale', textTone: 'textTone' }, uiScale: {}, textTone: {}, writes: [] };
  for (const o of OFFSETS) {
    vscode.__store('coai', 'uiScale', o);
    vscode.__store('coai', 'textTone', o);
    out.host.uiScale[o] = firstPost(scaleHost.pushUiScaleTo);
    out.host.textTone[o] = firstPost(toneHost.pushTextToneTo);
  }
  for (const [current, delta] of PRESSES) {
    vscode.__store('coai', 'uiScale', current);
    vscode.__store('coai', 'textTone', current);
    await scaleHost.applyZoomDelta(delta);
    await toneHost.applyToneDelta(delta);
    const [scaleWrite, toneWrite, ...more] = vscode.__takeWrites();
    if (more.length !== 0 || scaleWrite.key !== 'uiScale' || toneWrite.key !== 'textTone') {
      throw new Error(`expected one uiScale write and one textTone write for a press of ${delta} at ${String(current)}`);
    }
    out.host.writes.push({
      current,
      delta,
      uiScale: scaleWrite.value,
      textTone: toneWrite.value,
      scope: targetName(scaleWrite.target) === targetName(toneWrite.target) ? targetName(scaleWrite.target) : 'DIFFERENT',
    });
  }

  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
} finally {
  rmSync(work, { recursive: true, force: true });
}
