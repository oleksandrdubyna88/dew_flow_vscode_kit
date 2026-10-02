import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { test } from 'node:test';

import { createCatalog } from '../help/catalog';
import { staleTranslations } from '../help/coverage';
import { digestOf } from '../help/digest';
import type { Digest, Translations } from '../help/types';
import { ALPHA, BETA, BETA_BEFORE, GAMMA, catalog } from './fixtures/helpDigestsCatalog';

/**
 * `scripts/help-digests.mjs`, RUN — a child `node` with a 10 s deadline, over a catalog module compiled
 * with the suite (`fixtures/helpDigestsCatalog.ts`), against the kit's own compiled entry (`--kit`).
 *
 * It prints exactly the pairs `staleTranslations` lists, grouped by language, with the replacement
 * `from` line for each (epic 2 plan round, finding 0) — and pasting those lines makes the catalog fresh,
 * which the last test proves by doing it.
 */

const SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'help-digests.mjs');
const KIT = path.resolve(__dirname, '..', 'index.js');
const FIXTURE = path.resolve(__dirname, 'fixtures', 'helpDigestsCatalog.js');

function run(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.error, undefined, `the script did not run: ${String(result.error)}`);

  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('help-digests prints exactly the stale and unknown pairs, by language, with the from line each needs', () => {
  const { status, stdout, stderr } = run(FIXTURE, '--kit', KIT);

  assert.equal(stderr, '');
  assert.equal(
    stdout,
    [
      'help-digests: 3 translation(s) were not made from the current English.',
      'Re-check each against its English article, then set its from entry to the line shown.',
      '',
      'ru',
      `  "beta": "${digestOf(BETA.en)}", // stale: made from ${digestOf(BETA_BEFORE)}`,
      `  "gamma": "${digestOf(GAMMA.en)}", // unknown: no from entry`,
      'uk',
      `  "alpha": "${digestOf(ALPHA.en)}", // unknown: no from entry`,
      '',
    ].join('\n'),
  );
  assert.equal(status, 1, 'a stale catalog is a finding, so the exit says so');
});

test('help-digests lists the same pairs staleTranslations does — the script decides nothing of its own', () => {
  const printed = [...run(FIXTURE, '--kit', KIT).stdout.matchAll(/^ {2}"([^"]+)": "([0-9a-f]{8})"/gmu)].map((m) => `${m[1]}=${m[2]}`);

  assert.deepEqual(printed.sort(), staleTranslations(catalog).map((entry) => `${entry.article}=${entry.current}`).sort());
});

test('pasting the printed lines into the modules makes the catalog fresh', () => {
  const lines = run(FIXTURE, '--kit', KIT).stdout.split('\n');
  const patch = new Map<string, Record<string, Digest>>();
  let language = '';
  for (const line of lines) {
    const entry = /^ {2}"([^"]+)": "([0-9a-f]{8})",/u.exec(line);
    if (entry === null) {
      language = /^[a-z]{2}$/u.test(line) ? line : language;
      continue;
    }
    patch.set(language, { ...patch.get(language), [entry[1] ?? '']: entry[2] ?? '' });
  }
  const translations: Translations = Object.fromEntries(
    Object.entries(catalog.translations).map(([lang, t]) => [lang, { bodies: t.bodies, from: { ...t.from, ...patch.get(lang) } }]),
  );

  assert.deepEqual([...patch.keys()], ['ru', 'uk']);
  assert.deepEqual(staleTranslations(createCatalog({ articles: catalog.articles, translations })), []);
});

test('help-digests says so, and exits 0, when every translation was made from the current English', () => {
  const { status, stdout, stderr } = run(FIXTURE, '--export', 'freshCatalog', '--kit', KIT);

  assert.equal(stderr, '');
  assert.equal(stdout, 'help-digests: every translation was made from the current English.\n');
  assert.equal(status, 0);
});

test('help-digests refuses, with exit 2, a call without a module, a module without the export, and an invalid catalog', () => {
  const bare = run();
  assert.equal(bare.status, 2);
  assert.match(bare.stderr, /^usage: help-digests <catalog module>/u);

  const absent = run(FIXTURE, '--export', 'nope', '--kit', KIT);
  assert.equal(absent.status, 2);
  assert.match(absent.stderr, /exports no "nope"/u);

  const broken = run(FIXTURE, '--export', 'brokenInput', '--kit', KIT);
  assert.equal(broken.status, 2);
  assert.match(broken.stderr, /ru translation has a body for omega/u);
  assert.equal(broken.stdout, '');
});
