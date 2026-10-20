import { GALLERY } from '../src/test/gallery';

/**
 * The page `scripts/layout-check.mjs` loads into headless Chrome (`research/PLAN_kit_components_storybook.md` §4.6a): every
 * DOM case of the gallery — the one list the Storybook, axe and the stylesheet check also read — rendered twice, once
 * in the page and once inside the gallery's deliberately narrow box, plus a probe that says where a box does not fit.
 * Bundled for the browser by the script's own esbuild call; story-only code, it ships nowhere.
 *
 * <p>The probe has no opinion about WHY a box overflows; it reports what a person would see: the page wider than the
 * window, an element past the window's edge, any box whose content is wider than the box (a scroll bar, or text spilling
 * out), a table wider than what holds it. The check treats every one of them as a defect, because the owner's rule is
 * that no table scrolls sideways (2026-10-15).</p>
 */

const VARIANTS = ['page', 'box'] as const;
const MAX_PER_SECTION = 6;
/** Sub-pixel rounding is not an overflow. */
const SLACK = 1;

interface SectionReport {
  readonly where: string;
  readonly problems: readonly string[];
}

export interface LayoutReport {
  readonly page: readonly string[];
  readonly sections: readonly SectionReport[];
  readonly errors: readonly string[];
}

declare global {
  interface Window {
    __kitLayout?: { apply(themeClass: string, sizeClass: string): string; cases: readonly string[] };
  }
}

const errors: string[] = [];

function sectionFor(componentId: string, caseId: string, variant: (typeof VARIANTS)[number], content: HTMLElement): HTMLElement {
  const section = document.createElement('section');
  section.dataset['where'] = `${componentId}/${caseId} [${variant}]`;
  if (variant === 'box') {
    const box = document.createElement('div');
    box.className = 'gallery-narrow';
    box.append(content);
    section.append(box);
  } else {
    section.append(content);
  }

  return section;
}

function build(): string[] {
  const placed: string[] = [];
  for (const component of GALLERY) {
    for (const entry of component.cases) {
      if (entry.kind !== 'dom') {
        continue;
      }
      for (const variant of VARIANTS) {
        try {
          const section = sectionFor(component.id, entry.id, variant, entry.render(document, `${component.id}-${entry.id}-${variant}`));
          document.body.append(section);
          placed.push(section.dataset['where'] ?? '');
        } catch (error) {
          errors.push(`${component.id}/${entry.id} [${variant}] did not render: ${String(error)}`);
        }
      }
    }
  }

  return placed;
}

function describe(node: Element): string {
  const classes = node.classList.length > 0 ? `.${[...node.classList].join('.')}` : '';

  return `${node.tagName.toLowerCase()}${classes}`;
}

function visible(node: Element): boolean {
  return node.getClientRects().length > 0 && node.getBoundingClientRect().height > 0;
}

/** Elements that end past either side of the window. */
function pastTheEdge(section: Element, width: number): string[] {
  return [...section.querySelectorAll('*')].filter((node) => {
    const box = node.getBoundingClientRect();

    return visible(node) && (box.right > width + SLACK || box.left < -SLACK);
  }).map((node) => `${describe(node)} ends at ${Math.round(node.getBoundingClientRect().right)}px of ${width}px`);
}

/** Any visible box whose content is wider than the box: a scroll bar, or text spilling out of it. */
function spilling(section: Element): string[] {
  return [...section.querySelectorAll('*')]
    .filter((node) => visible(node) && !node.matches('input') && node.clientWidth > 0 && node.scrollWidth > node.clientWidth + SLACK)
    .map((node) => `${describe(node)} holds ${node.scrollWidth}px in ${node.clientWidth}px`);
}

/** A table wider than what holds it — the same defect as a spill, seen from the table. */
function widerThanParent(section: Element): string[] {
  return [...section.querySelectorAll('table')].filter(visible).flatMap((table) => {
    const room = table.parentElement?.clientWidth ?? 0;
    const used = table.getBoundingClientRect().width;

    return used > room + SLACK ? [`${describe(table)} is ${Math.round(used)}px wide in ${room}px`] : [];
  });
}

function report(where: string, section: Element, width: number): SectionReport {
  const problems = [...pastTheEdge(section, width), ...spilling(section), ...widerThanParent(section)];

  return { where, problems: problems.slice(0, MAX_PER_SECTION) };
}

function probe(): LayoutReport {
  const root = document.documentElement;
  const page = root.scrollWidth > root.clientWidth + SLACK ? [`the page scrolls sideways: ${root.scrollWidth}px of ${root.clientWidth}px`] : [];
  const sections = [...document.querySelectorAll('section[data-where]')]
    .map((section) => report(section instanceof HTMLElement ? section.dataset['where'] ?? '' : '', section, root.clientWidth))
    .filter((entry) => entry.problems.length > 0);

  return { page, sections, errors };
}

const cases = build();

window.__kitLayout = {
  cases,
  /** Puts the body in a theme and a text size, then probes. The probe's answer is a JSON string. */
  apply: (themeClass, sizeClass) => {
    document.body.className = `${themeClass} ${sizeClass}`;

    return JSON.stringify(probe());
  },
};
