import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FakeDocument, type FakeNode } from './fakeDom';
import { COMPONENTS_CSS, containerBlocks, readCss, rules, tokenBlock, type Rule } from './cssTokens';
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

// ---- fit, never scroll (todo/PLAN_kit_components_storybook.md §4.6a, §5.2 item 26) -------------------------------

/** The table width each `stack` value stacks below — the table's OWN width, read through the size container. */
const STACK_BELOW: Readonly<Record<'narrow' | 'medium' | 'wide', string>> = { narrow: '(max-width: 30em)', medium: '(max-width: 40em)', wide: '(max-width: 60em)' };

/** What `property` is declared as by the rules of `all` whose selector list names `selector` exactly. */
function declaredOn(all: readonly Rule[], selector: string, property: string): string[] {
  return all.filter((rule) => rule.selectors.includes(selector)).flatMap((rule) => rule.declarations.get(property) ?? []);
}

test('.kit-table is a size container, so every width rule reads the box of the table and not the window', () => {
  assert.deepEqual(declaredOn(rules(CSS), '.kit-table', 'container'), ['kit-table / inline-size']);
});

test('there is one @container block per stack width, and each stacks only the table carrying its own class', () => {
  const blocks = containerBlocks(CSS);
  for (const [stack, condition] of Object.entries(STACK_BELOW)) {
    const named = blocks.filter((block) => block.name === 'kit-table' && block.condition === condition);
    assert.equal(named.length, 1, `expected one @container kit-table ${condition}, found ${named.length}`);
    const inside = (named[0]?.rules ?? []).flatMap((rule) => rule.selectors);
    assert.ok(inside.some((selector) => selector.startsWith(`.kit-table--stack-${stack} `) || selector === `.kit-table--stack-${stack}`), `nothing in the ${condition} block stacks .kit-table--stack-${stack}`);
    const others = ['narrow', 'medium', 'wide', 'never'].filter((other) => other !== stack);
    assert.ok(!inside.some((selector) => others.some((other) => selector.includes(`.kit-table--stack-${other}`))), `the ${condition} block touches another stack width`);
  }
  assert.ok(!blocks.some((block) => block.rules.some((rule) => rule.selectors.some((selector) => selector.includes('.kit-table--stack-never')))), 'stack: never must never stack at any width');
});

test('a stacked cell draws its column header from data-kit-label, the header row becomes sort buttons after "Sort by", and a plain header is hidden', () => {
  for (const [stack, condition] of Object.entries(STACK_BELOW)) {
    const inside = containerBlocks(CSS).find((block) => block.condition === condition)?.rules ?? [];
    const cell = inside.filter((rule) => rule.selectors.some((selector) => selector.startsWith(`.kit-table--stack-${stack} `) && selector.endsWith('td[data-kit-label]::before')));
    assert.equal(cell.length, 1, `${stack}: no rule draws the label`);
    assert.equal(cell[0]?.declarations.get('content'), "attr(data-kit-label) ': '");
    const sortBy = inside.filter((rule) => rule.selectors.some((selector) => selector.startsWith(`.kit-table--stack-${stack} `) && selector.endsWith('tr::before')));
    assert.equal(sortBy[0]?.declarations.get('content'), "'Sort by'", `${stack}: the Sort by words are missing`);
    const plain = inside.filter((rule) => rule.selectors.some((selector) => selector.includes(`.kit-table--stack-${stack} `) && selector.includes(':not(:has(.kit-table__sort))')));
    assert.equal(plain[0]?.declarations.get('display'), 'none', `${stack}: a header without a sort button stays visible when stacked`);
  }
});

test('a header breaks only between words, a cell may break anywhere, and an end cell stays on one line only while the table is wider than 30em', () => {
  const all = rules(CSS);
  assert.deepEqual(declaredOn(all, '.kit-table__head', 'overflow-wrap'), ['break-word']);
  assert.deepEqual(declaredOn(all, '.kit-table__cell', 'overflow-wrap'), ['anywhere']);
  assert.deepEqual(declaredOn(all, '.kit-table__cell--end', 'white-space'), ['nowrap', 'normal'], 'nowrap, then released inside the 30em block');
  const narrow = containerBlocks(CSS).find((block) => block.condition === STACK_BELOW.narrow)?.rules ?? [];
  assert.deepEqual(declaredOn(narrow, '.kit-table__cell--end', 'white-space'), ['normal']);
});

/** The declarations that would make a box scroll sideways or force a width: found by name and value, in any rule. */
function widthForcing(css: string): string[] {
  return rules(css).flatMap((rule) => [...rule.declarations].flatMap(([property, value]) => {
    const scrolls = (property === 'overflow-x' || property === 'overflow') && /\b(auto|scroll)\b/.test(value);
    const forced = property === 'min-width' && /\d(?:px|em|rem|ch|vw|vh|cm|mm|in|pt|pc|%)|max-content|calc\(/.test(value) && !/^0(?!\.)/.test(value);

    return scrolls || forced ? [`${rule.selectors.join(', ')} { ${property}: ${value} }`] : [];
  }));
}

test('no rule makes any box scroll sideways or forces a minimum width: a table fits its box', () => {
  assert.deepEqual(widthForcing(CSS), []);
});

test('the width-forcing scan finds each construct in a fixture, and lets min-width: 0 through', () => {
  assert.equal(widthForcing('.a { overflow-x: auto; } .b { overflow: scroll; } .c { min-width: 40em; } .d { min-width: 100%; }').length, 4);
  assert.deepEqual(widthForcing('.a { min-width: 0; overflow: hidden; } .b { overflow-x: visible; }'), []);
});

test('the container-block reader finds a block, its condition and its rules', () => {
  const found = containerBlocks('.x { a: b; } @container kit-table (max-width: 30em) { .y { c: d; } .z, .w { e: f; } }');
  assert.equal(found.length, 1);
  assert.equal(found[0]?.name, 'kit-table');
  assert.equal(found[0]?.condition, '(max-width: 30em)');
  assert.deepEqual(found[0]?.rules.map((rule) => rule.selectors), [['.y'], ['.z', '.w']]);
});
