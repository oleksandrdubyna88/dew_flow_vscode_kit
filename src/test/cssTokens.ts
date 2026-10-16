import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Reading the kit's stylesheet and the theme fixture as DATA — rules, declarations, `var()` chains and colours — for
 * `componentsCss.test.ts` and `contrast.test.ts`. A small reader of the subset those two files are written in (rules
 * without nesting, declarations `name: value;`, comments): anything it cannot place fails, naming it.
 */

const ROOT = path.resolve(__dirname, '..', '..');

export const COMPONENTS_CSS = path.join(ROOT, 'src', 'components', 'components.css');
export const THEMES_CSS = path.join(ROOT, '.storybook', 'vscode-themes.css');

export interface Rule {
  readonly selectors: readonly string[];
  readonly declarations: ReadonlyMap<string, string>;
}

export function readCss(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

/** Every rule of a flat stylesheet, comments removed. */
export function rules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: Rule[] = [];
  for (const [, head, body] of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = new Map<string, string>();
    for (const line of (body ?? '').split(';').map((part) => part.trim()).filter(Boolean)) {
      const colon = line.indexOf(':');
      assert.ok(colon > 0, `a declaration without a colon: ${line}`);
      declarations.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    }
    found.push({ selectors: (head ?? '').split(',').map((selector) => selector.trim()), declarations });
  }

  return found;
}

/** One `@container <name> (<condition>) { … }` block: what it asks of the container, and the rules inside. */
export interface ContainerBlock {
  readonly name: string;
  readonly condition: string;
  readonly rules: readonly Rule[];
}

/** Every `@container` block of a stylesheet (one level of nesting, which is all the kit writes), comments removed. */
export function containerBlocks(css: string): ContainerBlock[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: ContainerBlock[] = [];
  for (const [, name, condition, body] of text.matchAll(/@container\s+([a-z-]+)?\s*(\([^)]*\))\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)) {
    found.push({ name: name ?? '', condition: condition ?? '', rules: rules(body ?? '') });
  }

  return found;
}

/** The kit's token block: the one rule declaring `--kit-*` tokens on the three component roots. */
export function tokenBlock(css: string): ReadonlyMap<string, string> {
  const blocks = rules(css).filter((rule) => [...rule.declarations.keys()].some((name) => name.startsWith('--kit-')) && rule.selectors.includes('.kit-tabs'));
  assert.equal(blocks.length, 1, 'expected exactly one token block on .kit-tabs, .kit-table, .kit-rec');

  return new Map([...(blocks[0]?.declarations ?? new Map<string, string>())].filter(([name]) => name.startsWith('--kit-')));
}

/** The theme fixture: per body class, the `--vscode-*` values it carries. */
export function themes(css: string): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const found = new Map<string, ReadonlyMap<string, string>>();
  for (const rule of rules(css)) {
    const only = rule.selectors.length === 1 ? rule.selectors[0] ?? '' : '';
    const vars = [...rule.declarations].filter(([name]) => name.startsWith('--vscode-'));
    if (/^\.vscode-[a-z-]+$/.test(only) && vars.length > 0) {
      found.set(only.slice(1), new Map(vars));
    }
  }

  return found;
}

/** `var(--name, fallback)` split at its top level: the name and the fallback (empty when none). */
function splitVar(inner: string): { name: string; fallback: string | undefined } {
  let depth = 0;
  for (let at = 0; at < inner.length; at += 1) {
    const char = inner[at];
    depth += char === '(' ? 1 : char === ')' ? -1 : 0;
    if (char === ',' && depth === 0) {
      return { name: inner.slice(0, at).trim(), fallback: inner.slice(at + 1).trim() };
    }
  }

  return { name: inner.trim(), fallback: undefined };
}

/**
 * A value resolved through its `var()` chain against `scope` (the theme's `--vscode-*` values and the kit's tokens),
 * as a browser does it: a variable that is not set takes the fallback; one without a fallback is `undefined`.
 */
export function resolve(value: string, scope: ReadonlyMap<string, string>, depth = 0): string | undefined {
  assert.ok(depth < 20, `a var() chain that does not end: ${value}`);
  const call = /^var\((.*)\)$/s.exec(value.trim());
  if (call === null) {
    return value.trim();
  }
  const { name, fallback } = splitVar(call[1] ?? '');
  const set = scope.get(name);
  if (set !== undefined) {
    return resolve(set, scope, depth + 1);
  }

  return fallback === undefined ? undefined : resolve(fallback, scope, depth + 1);
}

export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** `#rgb`, `#rrggbb`, `rgba(r, g, b, a)`, `rgb(r, g, b)` or `transparent`; anything else fails, naming it. */
export function colour(value: string): Rgba {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex !== null) {
    const digits = (hex[1] ?? '').length === 3 ? [...(hex[1] ?? '')].map((d) => d + d).join('') : hex[1] ?? '';
    return { r: parseInt(digits.slice(0, 2), 16), g: parseInt(digits.slice(2, 4), 16), b: parseInt(digits.slice(4, 6), 16), a: 1 };
  }
  const fn = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(value);
  if (fn !== null) {
    return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]), a: fn[4] === undefined ? 1 : Number(fn[4]) };
  }
  assert.equal(value, 'transparent', `not a colour this reader knows: ${value}`);

  return { r: 0, g: 0, b: 0, a: 0 };
}

/**
 * `top` painted over the opaque `under`, as a browser composites it: the alpha is first held as 8 bits, then each
 * channel blended and rounded.
 */
export function over(top: Rgba, under: Rgba): Rgba {
  const alpha = Math.round(top.a * 255) / 255;
  const blend = (a: number, b: number): number => Math.round(a * alpha + b * (1 - alpha));

  return { r: blend(top.r, under.r), g: blend(top.g, under.g), b: blend(top.b, under.b), a: 1 };
}

function channel(value: number): number {
  const c = value / 255;

  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance of an opaque colour. */
export function luminance(c: Rgba): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** WCAG 2.x contrast ratio of two opaque colours. */
export function ratio(a: Rgba, b: Rgba): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}
