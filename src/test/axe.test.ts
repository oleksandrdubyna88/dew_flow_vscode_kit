import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { test } from 'node:test';

import { createDataTable } from '../components/dataTable';
import { COMPONENTS_CSS, readCss } from './cssTokens';
import { jsdomDriver, jsdomWindow, type JsdomWindow } from './domDrivers';
import { GALLERY, type GalleryCase } from './gallery';

/**
 * axe-core over every gallery case, in jsdom, inside `npm test` (`research/PLAN_kit_components_storybook.md` §4.10) — so it
 * runs on both CI legs and covers exactly the states the Storybook shows. The WCAG 2.x A/AA rules are asked for;
 * rules that need a rendering (colour contrast above all) come back "incomplete" in jsdom, which is why contrast is
 * `contrast.test.ts`'s job. A companion case with a known violation proves axe is alive in this harness.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
/** axe-core's own bundled source, run inside the jsdom window — axe's documented way into jsdom. */
const AXE_SOURCE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const CSS = readCss(COMPONENTS_CSS);

interface AxeViolation {
  readonly id: string;
  readonly help: string;
  readonly nodes: readonly { readonly html: string }[];
}

interface AxeApi {
  run(context: object, options: object): Promise<{ readonly violations: readonly AxeViolation[] }>;
}

/** Loads axe into `window` and runs it over its document; answers the violations as `rule: html` lines. */
async function violations(window: JsdomWindow): Promise<string[]> {
  // The source is axe-core's own file from node_modules, evaluated inside the throwaway jsdom window (whose own page
  // scripts never run) — the documented way to run axe in jsdom; nothing from a page or a test input is evaluated.
  window.eval(AXE_SOURCE);
  const axe = window.eval('window.axe') as AxeApi;
  const result = await axe.run(window.document, {
    runOnly: { type: 'tag', values: TAGS },
    resultTypes: ['violations'],
    // jsdom has no rendering to measure contrast on (axe reaches for a canvas it does not have); the tokens'
    // contrast is contrast.test.ts's job, computed from VS Code's own theme values.
    rules: { 'color-contrast': { enabled: false } },
  });

  // Copied into this realm: jsdom's arrays carry the window's own Array.prototype.
  return [...result.violations].flatMap((violation) => [...violation.nodes].map((node) => `${violation.id}: ${node.html.slice(0, 160)}`));
}

/** A fresh window holding one gallery case as a page shows it, with the stylesheet it ships with. */
function windowFor(entry: GalleryCase): JsdomWindow {
  if (entry.kind === 'page') {
    return jsdomWindow(entry.html);
  }
  const window = jsdomWindow();
  const style = window.document.createElement('style');
  style.textContent = entry.kind === 'html' ? entry.css : CSS;
  window.document.head.appendChild(style);
  if (entry.kind === 'html') {
    // Test code: the kit's own renderer's markup (zoomControlHtml / toneControlHtml), in a jsdom whose scripts never run.
    window.document.body.innerHTML = entry.html;
  } else {
    jsdomDriver(window).attach(entry.render(window.document));
  }

  return window;
}

/**
 * KNOWN, in a part K1 shows but does not own: the Help viewer page has no `lang` on `<html>` and no `<title>`. It is
 * byte-compatible with ConnectOtherAIs' page by contract (`research/architecture.md`, the help module), so adding them
 * is a change to BOTH products, not to this story — it is reported as an open item. Allowlisted by component AND
 * rule id, never by component alone; the test below fails the day either is fixed, so the entry cannot outlive the
 * defect.
 */
const KNOWN: ReadonlyMap<string, readonly string[]> = new Map([['helpViewer', ['document-title', 'html-has-lang']]]);

const unknown = (component: string, found: readonly string[]): string[] =>
  found.filter((line) => !(KNOWN.get(component) ?? []).some((rule) => line.startsWith(`${rule}:`)));

for (const component of GALLERY) {
  for (const entry of component.cases) {
    test(`axe: no WCAG A/AA violation in ${component.id} / ${entry.id}`, async () => {
      const window = windowFor(entry);
      try {
        assert.deepEqual(unknown(component.id, await violations(window)), []);
      } finally {
        window.close();
      }
    });
  }
}

test('the known Help viewer violations still occur — when the page gains lang and a title, this entry must go', async () => {
  const help = GALLERY.find((component) => component.id === 'helpViewer')?.cases[0] ?? assert.fail('no help case');
  const window = windowFor(help);
  try {
    const rules = (await violations(window)).map((line) => line.slice(0, line.indexOf(':')));
    assert.deepEqual([...new Set(rules)].sort(), [...(KNOWN.get('helpViewer') ?? [])].sort());
  } finally {
    window.close();
  }
});

test('axe is alive here: an unnamed button placed beside a table IS reported, once — the table\'s own named reveal button is not', async () => {
  const window = jsdomWindow();
  try {
    const driver = jsdomDriver(window);
    const view = createDataTable(driver.doc, {
      label: 'Broken', columns: [{ key: 'a', header: 'A', value: () => 'x' }], rows: [{}],
      reveal: { header: 'Detail', button: () => 'Show the detail', onReveal: () => undefined, buttonText: ' ' },
    });
    const root = driver.attach(view.root);
    const button = root.one('button[data-kit-reveal]');
    assert.equal(button.attribute('aria-label'), 'Show the detail');
    view.root.appendChild(window.document.createElement('button'));
    const found = await violations(window);
    assert.equal(found.filter((line) => line.startsWith('button-name')).length, 1, found.join('\n'));
  } finally {
    window.close();
  }
});
