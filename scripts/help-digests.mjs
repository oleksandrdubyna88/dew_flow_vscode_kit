#!/usr/bin/env node
/**
 * help-digests — which help translations were not made from the current English, and the `from` line
 * each one needs once it has been re-checked.
 *
 * Usage:
 *   node help-digests.mjs <catalog module> [--export <name>] [--kit <kit entry>]
 *
 * `<catalog module>` is the consumer's compiled module that exports its catalog (or the
 * `{ articles, translations }` it makes one from) as `catalog`, or under `--export <name>`. `--kit` points
 * at the kit's compiled entry; it defaults to this package's own `dist/index.js` (beside `scripts/`).
 *
 * It prints exactly the pairs `staleTranslations` lists (epic 2 plan round, finding 0), grouped by
 * language, each as the line to put in that language's `from` map:
 *
 *   ru
 *     "the-gate": "5e6f7a8b", // stale: made from 1a2b3c4d
 *
 * The script decides nothing itself: the catalog is re-made with the kit's `createCatalog` (so a broken
 * module is refused here exactly as at load) and the list is the kit's. Node built-ins only.
 *
 * Exit: 0 every translation was made from the current English; 1 pairs were printed; 2 usage, load or
 * validation error (on stderr). The exit is set through `process.exitCode`, never `process.exit()`,
 * so a report written to a pipe is never cut short.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const USAGE = 'usage: help-digests <catalog module> [--export <name>] [--kit <kit entry>]';

/** A refusal: its message goes to stderr and the exit is 2. */
class Refusal extends Error {}

function readArguments() {
  let parsed;
  try {
    parsed = parseArgs({ allowPositionals: true, options: { export: { type: 'string', default: 'catalog' }, kit: { type: 'string' } } });
  } catch (error) {
    throw new Refusal(`${error.message}\n${USAGE}`);
  }
  if (parsed.positionals.length !== 1) {
    throw new Refusal(USAGE);
  }

  return { module: parsed.positionals[0], ...parsed.values };
}

/** `import()` a file, or refuse naming what could not be loaded. */
async function load(href, what) {
  try {
    return await import(href);
  } catch (error) {
    throw new Refusal(`help-digests: cannot load ${what}: ${error.message}`);
  }
}

/** A named export — ESM named, or a member of a CommonJS `module.exports` (which `import()` hands over as `default`). */
function exported(loaded, name) {
  return loaded[name] ?? loaded.default?.[name];
}

function catalogOf(kit, input, where) {
  try {
    return kit.createCatalog(input);
  } catch (error) {
    throw new Refusal(`help-digests: ${where}: ${error.message}`);
  }
}

function fromLine(pair) {
  const why = pair.stale === 'stale' ? `stale: made from ${pair.from}` : 'unknown: no from entry';
  return `  ${JSON.stringify(pair.article)}: ${JSON.stringify(pair.current)}, // ${why}`;
}

/** The pairs, grouped by language in the catalog's order, each as its replacement `from` line. */
function report(catalog, pairs) {
  const lines = [
    `help-digests: ${pairs.length} translation(s) were not made from the current English.`,
    'Re-check each against its English article, then set its from entry to the line shown.',
    '',
  ];
  for (const language of catalog.languages) {
    const mine = pairs.filter((pair) => pair.language === language);
    if (mine.length > 0) {
      lines.push(language, ...mine.map(fromLine));
    }
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = readArguments();
  const kitHref = args.kit === undefined ? new URL('../dist/index.js', import.meta.url).href : pathToFileURL(resolve(args.kit)).href;
  const kitModule = await load(kitHref, `the kit from ${kitHref}`);
  const kit = kitModule.default ?? kitModule;
  const input = exported(await load(pathToFileURL(resolve(args.module)).href, args.module), args.export);
  if (input === undefined) {
    throw new Refusal(`help-digests: ${args.module} exports no ${JSON.stringify(args.export)}.`);
  }
  const catalog = catalogOf(kit, input, args.module);
  const pairs = kit.staleTranslations(catalog);
  if (pairs.length === 0) {
    process.stdout.write('help-digests: every translation was made from the current English.\n');
    return 0;
  }
  process.stdout.write(report(catalog, pairs));

  return 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  if (!(error instanceof Refusal)) {
    throw error;
  }
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
