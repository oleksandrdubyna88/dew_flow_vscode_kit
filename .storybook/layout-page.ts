import { GALLERY } from '../src/test/gallery';

/**
 * The page `scripts/layout-check.mjs` loads into headless Chrome (`research/PLAN_kit_components_storybook.md` §4.6a): every
 * DOM case of the gallery — the one list the Storybook, axe and the stylesheet check also read — rendered twice, once
 * in the page and once inside the gallery's deliberately narrow box, each in a `<section data-where="…">` that names it.
 * Bundled for the browser by the script's own esbuild call; story-only code, it ships nowhere.
 *
 * <p>It asks nothing of the page and measures nothing: the probe that says where a box does not fit is the shared one in
 * `src/layout/probe.ts`, which the layout bin runs over a consumer's page too, and the section label it reads is the
 * `data-where` this file writes. A case that cannot render throws, and the check reports the page script's exception
 * as a defect — the owner's rule is that no table scrolls sideways (2026-10-15), and a case that is not there cannot show it.</p>
 */

const VARIANTS = ['page', 'box'] as const;

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

for (const component of GALLERY) {
  for (const entry of component.cases) {
    if (entry.kind !== 'dom') {
      continue;
    }
    for (const variant of VARIANTS) {
      document.body.append(sectionFor(component.id, entry.id, variant, entry.render(document, `${component.id}-${entry.id}-${variant}`)));
    }
  }
}
