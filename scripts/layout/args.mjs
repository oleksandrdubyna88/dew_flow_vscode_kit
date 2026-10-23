/**
 * The bin's command line (`todo/PLAN_layout_check_bin.md` §3): parsed and validated BEFORE any browser is looked for, so a
 * wrong argument is exit 2 and never a 3. The only I/O is `statSync` on the page files.
 */
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

/** The command line is wrong (exit 2) - or the page's own selectors are, which only the browser can tell. */
export class UsageError extends Error {}

export const USAGE = 'usage: vscode-webview-kit-layout-check --page <file.html> [--page <file.html> ...] [--rows <css selector>] [--single-line <css selector>] [--widths 300,1280,1920] [--themes dark,light,high-contrast,high-contrast-light] [--sizes small,default,large] [--json <out.json>]';

export const DEFAULT_WIDTHS = [300, 1280, 1920];
const MIN_WIDTH = 200;
const MAX_WIDTH = 4000;

/** Theme name to the body class VS Code puts on a webview (`vscode-themes.css`). */
export const THEMES = new Map([
  ['dark', 'vscode-dark'],
  ['light', 'vscode-light'],
  ['high-contrast', 'vscode-high-contrast'],
  ['high-contrast-light', 'vscode-high-contrast-light'],
]);

/** Size name to the editor font size in px: VS Code's smallest sensible, its default, and a large accessibility setting. */
export const SIZES = new Map([
  ['small', 11],
  ['default', 13],
  ['large', 18],
]);

const OPTIONS = {
  page: { type: 'string', multiple: true },
  rows: { type: 'string' },
  'single-line': { type: 'string' },
  widths: { type: 'string' },
  themes: { type: 'string' },
  sizes: { type: 'string' },
  json: { type: 'string' },
  help: { type: 'boolean' },
};

/** `parseArgs` throws with its own wording; the bin says it in its own words. */
function parse(argv) {
  try {
    return parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (error) {
    const unknown = /'(--?[^']+)'/.exec(error.message);
    throw new UsageError(error.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' && unknown ? `unknown option ${unknown[1]}` : error.message);
  }
}

/** One page argument: it must exist, be a file and end in .html. Answers the absolute path. */
function pageFile(argument) {
  const file = resolve(argument);
  let stats;
  try {
    stats = statSync(file);
  } catch {
    throw new UsageError(`the page ${argument} does not exist`);
  }
  if (!stats.isFile()) {
    throw new UsageError(`the page ${argument} is not a file`);
  }
  if (!file.toLowerCase().endsWith('.html')) {
    throw new UsageError(`the page ${argument} must end in .html`);
  }

  return file;
}

function list(text) {
  return [...new Set(text.split(',').map((item) => item.trim()))];
}

function widthsOf(text) {
  return list(text).map((item) => {
    const width = /^\d+$/.test(item) ? Number(item) : Number.NaN;
    if (!(width >= MIN_WIDTH && width <= MAX_WIDTH)) {
      throw new UsageError(`a width must be a whole number of px from ${MIN_WIDTH} to ${MAX_WIDTH}, got "${item}"`);
    }

    return width;
  });
}

/** The chosen names, each of which must be a key of `known`. */
function namesOf(text, known, what) {
  return list(text).map((name) => {
    if (!known.has(name)) {
      throw new UsageError(`unknown ${what} "${name}" (known: ${[...known.keys()].join(', ')})`);
    }

    return name;
  });
}

function selectorOf(value, option) {
  if (value !== undefined && value.trim() === '') {
    throw new UsageError(`--${option} needs a non-empty CSS selector`);
  }

  return value?.trim();
}

/**
 * The run's settings, or `{ help: true }`. Throws `UsageError` naming the first thing wrong:
 * `{ pages: [{ label, file }], rows, singleLine, widths, themes: [name], sizes: [name], json }`.
 */
export function parseArguments(argv) {
  const { values, positionals } = parse(argv);
  if (values.help) {
    return { help: true };
  }
  if (positionals.length > 0) {
    throw new UsageError(`unexpected argument ${positionals[0]}`);
  }
  const pages = values.page ?? [];
  if (pages.length === 0) {
    throw new UsageError('needs at least one --page <file.html>');
  }

  return {
    help: false,
    pages: pages.map((label) => ({ label, file: pageFile(label) })),
    rows: selectorOf(values.rows, 'rows'),
    singleLine: selectorOf(values['single-line'], 'single-line'),
    widths: values.widths === undefined ? DEFAULT_WIDTHS : widthsOf(values.widths),
    themes: values.themes === undefined ? [...THEMES.keys()] : namesOf(values.themes, THEMES, 'theme'),
    sizes: values.sizes === undefined ? [...SIZES.keys()] : namesOf(values.sizes, SIZES, 'size'),
    json: values.json,
  };
}
