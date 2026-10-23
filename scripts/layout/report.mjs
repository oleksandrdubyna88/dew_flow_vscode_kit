/**
 * What the check says (`todo/PLAN_layout_check_bin.md` §3): one line per defect -
 * `FAIL <page> <width> <theme> <size> <what>` - and a summary; `--json <file>` writes the same as JSON. A defect that
 * belongs to no state (a request the page was refused) has `-` for the width, theme and size.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** The defect as a sentence: `[group] where problem`. */
export function whatOf(finding) {
  return `${finding.group === '' ? '' : `[${finding.group}] `}${finding.where} ${finding.problem}`;
}

/** `FAIL <page> <width> <theme> <size> <what>` */
export function failLine(finding) {
  return `FAIL ${finding.page} ${finding.width ?? '-'} ${finding.theme ?? '-'} ${finding.size ?? '-'} ${whatOf(finding)}`;
}

/** Every defect line, at most `limit` of them (the JSON report has them all), then a line saying how many were left out. */
export function failLines(findings, limit = 200) {
  const lines = findings.slice(0, limit).map(failLine);

  return findings.length > limit ? [...lines, `... and ${findings.length - limit} more (the --json report lists every one)`] : lines;
}

/** The one-line verdict. */
export function verdict(findings, pages, states) {
  return findings.length === 0
    ? `layout-check: ok - ${pages} page(s), ${states} state(s): nothing scrolls sideways, spills or is wider than its box.`
    : `layout-check: RED - ${findings.length} defect(s) in ${new Set(findings.map((finding) => finding.page)).size} of ${pages} page(s).`;
}

/** The report as a file: `{ ok, pages, states, findings }`. The folder is made when it is missing. */
export function writeJson(file, { findings, pages, states }) {
  const target = resolve(file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify({ ok: findings.length === 0, pages, states, findings }, null, 2)}\n`);
}
