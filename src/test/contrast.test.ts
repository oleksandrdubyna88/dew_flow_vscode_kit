import assert from 'node:assert/strict';
import { test } from 'node:test';

import { colour, COMPONENTS_CSS, over, ratio, readCss, resolve, THEMES_CSS, themes, tokenBlock, type Rgba } from './cssTokens';

/**
 * The theme tokens' contrast under VS Code's four built-in reference themes (`research/PLAN_kit_components_storybook.md`
 * §5.4). The values are `.storybook/vscode-themes.css` — resolved from VS Code's own sources, a variable VS Code
 * leaves unset ABSENT there, so a token's `var()` fallback is what paints exactly where it would in a webview.
 *
 * The pairs are DERIVED from the token names (`components.css`'s header): a `-fg` token is text, 4.5:1 against
 * `--kit-bg` or its own `-bg` sibling; a `-mark` token is a non-text indicator, 3:1 against `--kit-bg`; a `-bg` token
 * without an `-fg` sibling must carry `--kit-fg`. A token that resolves to nothing in a theme is a failure, never a
 * skip. What this proves: the MAPPING under these values — not a user's own theme, not a rendering.
 */

const TOKENS = tokenBlock(readCss(COMPONENTS_CSS));
const THEMES = themes(readCss(THEMES_CSS));

interface Pair {
  readonly fg: string;
  readonly bg: string;
  readonly minimum: number;
}

/** The pairs the naming convention implies. */
function pairs(tokens: ReadonlyMap<string, string>): Pair[] {
  const names = [...tokens.keys()];
  const sibling = (name: string, from: string, to: string): string | undefined => {
    const other = name.slice(0, -from.length) + to;
    return names.includes(other) ? other : undefined;
  };
  const text = names.filter((name) => name.endsWith('-fg')).map((fg) => ({ fg, bg: sibling(fg, '-fg', '-bg') ?? '--kit-bg', minimum: 4.5 }));
  const marks = names.filter((name) => name.endsWith('-mark')).map((fg) => ({ fg, bg: '--kit-bg', minimum: 3 }));
  const surfaces = names
    .filter((name) => name.endsWith('-bg') && name !== '--kit-bg' && sibling(name, '-bg', '-fg') === undefined)
    .map((bg) => ({ fg: '--kit-fg', bg, minimum: 4.5 }));

  return [...text, ...marks, ...surfaces];
}

/** A token's colour in a theme, or the failure naming why it has none. */
function tokenColour(name: string, scope: ReadonlyMap<string, string>, theme: string): Rgba | string {
  const value = resolve(`var(${name})`, scope);
  if (value === undefined) {
    return `${theme}: ${name} resolves to nothing`;
  }

  return colour(value);
}

/** Every pair below its minimum in one theme, as `theme: fg on bg = ratio < minimum`. */
function failures(theme: string, vars: ReadonlyMap<string, string>, tokens: ReadonlyMap<string, string>): string[] {
  const scope = new Map([...vars, ...tokens]);
  const page = tokenColour('--kit-bg', scope, theme);
  if (typeof page === 'string') {
    return [page];
  }

  return pairs(tokens).flatMap(({ fg, bg, minimum }) => {
    const back = tokenColour(bg, scope, theme);
    const front = tokenColour(fg, scope, theme);
    if (typeof back === 'string' || typeof front === 'string') {
      return [typeof back === 'string' ? back : String(front)];
    }
    const under = over(back, page);
    const measured = ratio(over(front, under), under);
    return measured >= minimum ? [] : [`${theme}: ${fg} on ${bg} = ${measured.toFixed(2)} < ${minimum}`];
  });
}

test('the theme fixture carries the four reference themes, and the token block its tokens', () => {
  assert.deepEqual([...THEMES.keys()].sort(), ['vscode-dark', 'vscode-high-contrast', 'vscode-high-contrast-light', 'vscode-light']);
  assert.ok(TOKENS.size >= 15);
});

test('the pairs are derived, and the derivation is alive: it holds the tone marks, the text, and the input text on its own background', () => {
  const derived = pairs(TOKENS).map(({ fg, bg, minimum }) => `${fg}/${bg}/${minimum}`);
  for (const known of ['--kit-tone-ok-mark/--kit-bg/3', '--kit-tone-warning-mark/--kit-bg/3', '--kit-fg/--kit-bg/4.5', '--kit-input-fg/--kit-input-bg/4.5', '--kit-fg/--kit-row-hover-bg/4.5', '--kit-focus-mark/--kit-bg/3']) {
    assert.ok(derived.includes(known), `${known} is not among ${derived.join(', ')}`);
  }
});

for (const [theme, vars] of THEMES) {
  test(`every token pair meets its ratio in ${theme} — text 4.5:1, indicators 3:1`, () => {
    assert.deepEqual(failures(theme, vars, TOKENS), []);
  });
}

test('the check has teeth: the obvious mappings it was written against fail exactly where they were measured to', () => {
  const light = THEMES.get('vscode-light') ?? assert.fail('no light theme');
  const hcDark = THEMES.get('vscode-high-contrast') ?? assert.fail('no high-contrast theme');
  const okOnTestingIcon = new Map([...TOKENS, ['--kit-tone-ok-mark', 'var(--vscode-testing-iconPassed, #73c991)']]);
  assert.deepEqual(failures('vscode-light', light, okOnTestingIcon), ['vscode-light: --kit-tone-ok-mark on --kit-bg = 2.00 < 3']);
  const warningWithoutFallback = new Map([...TOKENS, ['--kit-tone-warning-mark', 'var(--vscode-list-warningForeground)']]);
  assert.deepEqual(failures('vscode-high-contrast', hcDark, warningWithoutFallback), ['vscode-high-contrast: --kit-tone-warning-mark resolves to nothing']);
});

test('the colour reader: hex, rgba composited as a browser paints it, and the WCAG ratio of black on white', () => {
  assert.deepEqual(colour('#0f4A85'), { r: 15, g: 74, b: 133, a: 1 });
  assert.deepEqual(colour('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(over(colour('rgba(255, 255, 255, 0.7)'), colour('#000000')), { r: 179, g: 179, b: 179, a: 1 });
  assert.equal(ratio(colour('#000000'), colour('#ffffff')).toFixed(1), '21.0');
  assert.equal(resolve('var(--a, var(--b, #123456))', new Map()), '#123456');
  assert.equal(resolve('var(--a)', new Map()), undefined);
  assert.throws(() => colour('red'), /not a colour this reader knows/);
});
