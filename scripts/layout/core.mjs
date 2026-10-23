/**
 * The check itself, shared by the bin and the kit's own gallery check (`todo/PLAN_layout_check_bin.md` §3 - ONE
 * implementation): every page, at every width x theme x text size, asked the probe (`dist/layout/probe.js`, injected
 * after the load together with `dist/layout/vscode-themes.css`) where a box does not fit.
 *
 * The viewport is set with `Emulation.setDeviceMetricsOverride`: headless Chrome will not lay out narrower than about
 * 500 px from `--window-size`, so without the override a "300 px" check would silently be a 500 px one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { UsageError, SIZES, THEMES } from './args.mjs';
import { EnvironmentError } from './cleanup.mjs';
import { evaluate, openPage, visit } from './devtools.mjs';
import { boundaryOf } from './netbox.mjs';

const HEIGHT = 900;

/** What the probe is told for one state: the theme's body class, every theme class (to take the others off), the font size, the selectors. */
function optionsFor(settings, theme, size) {
  return {
    themeClass: THEMES.get(theme),
    themeClasses: [...THEMES.values()],
    fontPx: SIZES.get(size),
    ...(settings.rows === undefined ? {} : { rows: settings.rows }),
    ...(settings.singleLine === undefined ? {} : { singleLine: settings.singleLine }),
  };
}

/** The page's probe and theme sheet, injected into the loaded document. The stylesheet travels as a JSON string literal. */
function installExpression(assets) {
  return `${assets.probe}\n;window.__kitLayoutProbe.install(${JSON.stringify(assets.themes)});true`;
}

/** The probe's answer for one state, turned into findings; a selector the browser cannot parse is a usage error. */
function findingsOf(report, settings) {
  if (report.invalid !== '') {
    const option = report.invalid === 'rows' ? '--rows' : '--single-line';
    const selector = report.invalid === 'rows' ? settings.rows : settings.singleLine;
    throw new UsageError(`${option} "${selector}" is not a valid CSS selector`);
  }

  return report.findings;
}

/** One state: the theme and size applied, the probe run. Answers `{ findings, groups }` where each finding carries its state. */
async function checkState(tools, session, state, ctx) {
  const { width, theme, size } = state;
  const report = JSON.parse(await evaluate(tools, session, `window.__kitLayoutProbe.run(${JSON.stringify(optionsFor(ctx.settings, theme, size))})`, ctx.limits));
  const found = findingsOf(report, ctx.settings).map((finding) => ({ page: ctx.label, width, theme, size, ...finding }));
  const scripts = session.exceptions.map((problem) => ({ page: ctx.label, width, theme, size, group: '', where: 'the page script', problem }));

  return { findings: [...found, ...scripts], groups: report.groups };
}

/** One width: the page reloaded at that viewport, the probe injected, then every theme x size. */
async function checkWidth(tools, session, width, ctx) {
  await tools.send('Emulation.setDeviceMetricsOverride', { width, height: HEIGHT, deviceScaleFactor: 1, mobile: false }, session.sessionId);
  session.exceptions.length = 0;
  await visit(tools, session, ctx.url, ctx.limits);
  await evaluate(tools, session, installExpression(ctx.assets), ctx.limits);
  const outcome = { findings: [], states: 0, groups: 0 };
  for (const theme of ctx.settings.themes) {
    for (const size of ctx.settings.sizes) {
      const state = await checkState(tools, session, { width, theme, size }, ctx);
      outcome.findings.push(...state.findings);
      outcome.states += 1;
      outcome.groups = state.groups;
      ctx.progress(`${ctx.label} ${width}px ${theme} ${size}`, state.findings.length);
    }
  }

  return outcome;
}

/** What the page asked for that it may not have, as findings without a state. */
function refusedAsFindings(session, label) {
  return [...session.refused].map((url) => ({ page: label, width: null, theme: null, size: null, group: '', where: 'the page', problem: `asked for ${url} (only files under the page's own folder, data: and about: load)` }));
}

/** One page over the whole matrix. Answers `{ findings, states, groups }`. */
async function checkPage(tools, page, ctx) {
  const file = page.file;
  const session = await openPage(tools, page.boundary ?? boundaryOf(file));
  const pageCtx = { ...ctx, label: page.label, url: pathToFileURL(file).href };
  const total = { findings: [], states: 0, groups: 0 };
  for (const width of ctx.settings.widths) {
    const outcome = await checkWidth(tools, session, width, pageCtx);
    total.findings.push(...outcome.findings);
    total.states += outcome.states;
    total.groups = outcome.groups;
  }
  await tools.send('Target.closeTarget', { targetId: session.targetId }).catch(() => undefined);

  return { ...total, findings: [...total.findings, ...refusedAsFindings(session, page.label)] };
}

/**
 * Checks `pages` (`{ label, file, boundary? }` - `boundary` is the folder the page may read from, by default its own)
 * over `settings` (`{ widths, themes, sizes, rows?, singleLine? }`). `assets` are the contents of the probe script and the
 * theme sheet (`{ probe, themes }`); `progress(state, found)` is told of every state. Answers
 * `{ findings, states, groups }`, each finding `{ page, width, theme, size, group, where, problem }` (a request the
 * page was refused has no width, theme or size).
 */
export async function checkPages(tools, pages, settings, { assets, limits, progress = () => undefined }) {
  const total = { findings: [], states: 0, groups: 0 };
  for (const page of pages) {
    const outcome = await checkPage(tools, page, { settings, assets, limits, progress });
    total.findings.push(...outcome.findings);
    total.states += outcome.states;
    total.groups += outcome.groups;
  }

  return total;
}

/** The probe script and the theme sheet, read from the folder the build wrote them to (`dist/layout/`). */
export function readAssets(folder) {
  const read = (name) => {
    try {
      return readFileSync(join(folder, name), 'utf8');
    } catch (error) {
      throw new EnvironmentError(`cannot read ${join(folder, name)} (${error.code ?? error.message}) - the layout probe is built by "npm run build", which this package's prepack runs`);
    }
  };

  return { probe: read('probe.js'), themes: read('vscode-themes.css') };
}
