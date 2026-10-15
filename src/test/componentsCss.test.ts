import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FakeDocument, type FakeNode } from './fakeDom';
import { COMPONENTS_CSS, readCss, rules, tokenBlock } from './cssTokens';
import { GALLERY } from './gallery';

/**
 * `components.css` against what the components actually render (`todo/PLAN_kit_components_storybook.md` §5.2, items
 * 16–17). The motivating defect of `common.generated-code-tests` was a class every colour rule is scoped under,
 * missing from one rendering — a string check could not see it. So the classes are DERIVED from the DOM every gallery
 * case renders, never listed, and checked both ways: every `kit-*` class rendered has a rule, and every `kit-*` class
 * a rule names is rendered by some case.
 */

const CSS = readCss(COMPONENTS_CSS);

/** Every `kit-*` class any DOM gallery case renders, from the strict fake's own nodes. */
function renderedClasses(): Set<string> {
  const found = new Set<string>();
  for (const component of GALLERY) {
    for (const entry of component.cases) {
      if (entry.kind === 'dom') {
        const doc = new FakeDocument();
        const root: FakeNode = doc.node(entry.render(doc));
        [root, ...root.descendants()].flatMap((node) => node.classes).filter((name) => name.startsWith('kit-')).forEach((name) => found.add(name));
      }
    }
  }

  return found;
}

/** Every `kit-*` class a selector in `css` names. */
function styledClasses(css: string): Set<string> {
  return new Set(rules(css).flatMap((rule) => rule.selectors.flatMap((selector) => [...selector.matchAll(/\.(kit-[a-z0-9_-]+)/g)].map((match) => match[1] ?? ''))));
}

test('every kit-* class a gallery case renders has a rule in components.css', () => {
  const styled = styledClasses(CSS);
  const missing = [...renderedClasses()].filter((name) => !styled.has(name));

  assert.deepEqual(missing, [], `rendered with no rule: ${missing.join(', ')}`);
});

test('every kit-* class components.css styles is rendered by some gallery case — no rule for a class nothing emits', () => {
  const rendered = renderedClasses();
  const stale = [...styledClasses(CSS)].filter((name) => !rendered.has(name));

  assert.deepEqual(stale, [], `styled but never rendered: ${stale.join(', ')}`);
});

test('the two scans are alive: they find known classes on both sides', () => {
  assert.ok(renderedClasses().has('kit-tab--selected'));
  assert.ok(renderedClasses().has('kit-table__head--sorted-descending'));
  assert.ok(styledClasses(CSS).has('kit-rec--critical'));
  assert.deepEqual([...styledClasses('.a .kit-x:hover, .kit-y::after { color: red; }')], ['kit-x', 'kit-y']);
});

/** What a stylesheet loaded under a nonce must never ask for. */
const FORBIDDEN: readonly { readonly pattern: RegExp; readonly what: string }[] = [
  { pattern: /url\s*\(/i, what: 'url(' },
  { pattern: /@import/i, what: '@import' },
  { pattern: /!important/i, what: '!important' },
  { pattern: /expression\s*\(/i, what: 'expression(' },
];

function forbiddenIn(css: string): string[] {
  return FORBIDDEN.filter(({ pattern }) => pattern.test(css.replace(/\/\*[\s\S]*?\*\//g, ''))).map(({ what }) => what);
}

test('components.css fetches nothing and overrides nothing: no url(), @import, !important or expression()', () => {
  assert.deepEqual(forbiddenIn(CSS), []);
});

test('the forbidden-construct scan finds each construct in a fixture, and ignores one in a comment', () => {
  assert.deepEqual(forbiddenIn('a { b: url(x) } @import "y"; c { d: e !important; f: expression(1) }'), ['url(', '@import', '!important', 'expression(']);
  assert.deepEqual(forbiddenIn('/* url(x) @import */ a { b: c }'), []);
});

test('every --kit-* theme token reads a --vscode-* variable first — light, dark and high contrast stay VS Code\'s', () => {
  const tokens = tokenBlock(CSS);
  assert.ok(tokens.size >= 15, `only ${tokens.size} tokens found`);
  const notMapped = [...tokens].filter(([, value]) => !/^var\(--vscode-[A-Za-z0-9-]+/.test(value)).map(([name]) => name);
  assert.deepEqual(notMapped, []);
});
