import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

import { listAt, mapAt, parseWorkflow } from './workflowYaml';

/**
 * The reader the workflow tests stand on (`workflowYaml.ts`). A reader that half-reads a file would let a
 * structural test pass over the half it dropped, so it is pinned twice: what it returns for the subset,
 * and that it REFUSES what is outside the subset instead of guessing.
 */

const WORKFLOWS = path.resolve(__dirname, '..', '..', '.github', 'workflows');

const SAMPLE = [
  'name: sample # a trailing comment',
  '',
  '# a comment line',
  'on:',
  '  release:',
  '    types: [published]',
  '  workflow_dispatch:',
  'jobs:',
  '  one:',
  '    needs: [a, b]',
  '    steps:',
  '      - name: first',
  '        env:',
  "          QUOTED: 'a # not a comment'",
  '          EXPR: ${{ secrets.X != \'\' }}',
  '        run: |',
  '          echo one',
  '',
  '          echo two',
  '      - uses: owner/repo@abc # v1',
  '      -',
  '        run: npm test',
  '    labels:',
  '    - compact',
  '    - "quoted"',
  '',
].join('\n');

test('the reader returns the subset as plain values: mappings, sequences, flow sequences, block scalars, comments dropped', () => {
  assert.deepEqual(parseWorkflow(SAMPLE), {
    name: 'sample',
    on: { release: { types: ['published'] }, workflow_dispatch: null },
    jobs: {
      one: {
        needs: ['a', 'b'],
        steps: [
          { name: 'first', env: { QUOTED: 'a # not a comment', EXPR: "${{ secrets.X != '' }}" }, run: 'echo one\n\necho two\n' },
          { uses: 'owner/repo@abc' },
          { run: 'npm test' },
        ],
        labels: ['compact', 'quoted'],
      },
    },
  });
});

test('the reader keeps CRLF out of its answer and `|-` drops the final newline', () => {
  assert.deepEqual(parseWorkflow('a: |-\r\n  x\r\n  y\r\nb: c\r\n'), { a: 'x\ny', b: 'c' });
});

test('the reader REFUSES what is outside its subset, naming the line', () => {
  const refused: readonly (readonly [string, RegExp])[] = [
    ['a: &anchor x\n', /line 1: outside the subset/],
    ['a: *alias\n', /line 1: outside the subset/],
    ['a: !tag x\n', /line 1: outside the subset/],
    ['a: { b: c }\n', /line 1: outside the subset/],
    ['a: >\n  folded\n', /line 1: outside the subset/],
    ['a: [x,\n  y]\n', /line 1: a flow sequence must close/],
    ['a: b\na: c\n', /line 2: duplicate key "a"/],
    ['a:\n\tb: c\n', /line 2: a tab/],
    ['a: b\n---\nc: d\n', /line 2: more than one document/],
    ['a: plain\n  continued\n', /line 2: unexpected indentation/],
    ['a:\n    b: c\n  d: e\n', /line 3: (unexpected indentation|not read)/],
    ['just text\n', /line 1: not a "key: value" line/],
  ];
  for (const [source, why] of refused) {
    assert.throws(() => parseWorkflow(source), why, JSON.stringify(source));
  }
});

test('every workflow in .github/workflows is inside the subset — and the reader still finds a known instance in ci.yml', () => {
  const files = fs.readdirSync(WORKFLOWS).filter((file) => file.endsWith('.yml'));
  assert.ok(files.length >= 6, `expected the six workflows, found ${files.join(', ')}`);
  for (const file of files) {
    assert.doesNotThrow(() => parseWorkflow(fs.readFileSync(path.join(WORKFLOWS, file), 'utf8')), file);
  }
  const ci = mapAt(parseWorkflow(fs.readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8')), 'ci.yml');
  const matrix = mapAt(mapAt(mapAt(mapAt(ci['jobs'], 'jobs')['build-test'], 'build-test')['strategy'], 'strategy')['matrix'], 'matrix');
  assert.deepEqual(listAt(matrix['os'], 'os'), ['ubuntu-latest', 'windows-latest']);
});
