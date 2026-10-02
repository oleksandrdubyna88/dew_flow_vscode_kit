#!/usr/bin/env node
/**
 * Runs every compiled test file this package HAS, found by reading the directory rather than by a glob.
 *
 * The idea is ConnectOtherAIs' (`src_vs_code/scripts/run-tests.mjs`): a quoted glob reaches node
 * verbatim on Linux and is treated as a literal path; unquoted, cmd passes it verbatim on Windows; and
 * `node --test <dir>` once executed the DIRECTORY as a module. A readdir has no version, no shell and no
 * platform — and it cannot forget a file, which is what makes the count below worth printing.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = join('out', 'test');
const SUFFIX = '.test.js';

/** Every `*.test.js` under `out/test`, sorted; an absent directory contributes nothing. */
function discover() {
  let entries;
  try {
    entries = readdirSync(TEST_DIR);
  } catch {
    return [];
  }

  return entries.filter((f) => f.endsWith(SUFFIX)).sort().map((f) => join(TEST_DIR, f));
}

const files = discover();
if (files.length === 0) {
  console.error(`no compiled test files in ${TEST_DIR} — did the compile step run?`);
  process.exit(1);
}
// Printed because the count is the thing that silently falls: a suite running fewer files than last week
// should say so in the log, not only in a pass total nobody compares.
console.log(`run-tests: ${files.length} compiled test file(s)`);

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
