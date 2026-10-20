import GALLERY_CSS from '../.storybook/gallery.css?raw';
import THEMES_CSS from '../.storybook/vscode-themes.css?raw';
import { framed, GALLERY, galleryCase, GALLERY_NONCE, type GalleryCase } from '../src/test/gallery';

/**
 * Turning a gallery case into what Storybook's HTML renderer shows (`research/PLAN_kit_components_storybook.md` §4.9).
 * The cases themselves live in `src/test/gallery/` — the one list the Storybook, axe and the stylesheet check all
 * read. Story-only code: it may use `document` and an `iframe`, which the kit's components never do.
 */

const THEME_CLASSES = ['vscode-dark', 'vscode-light', 'vscode-high-contrast', 'vscode-high-contrast-light'] as const;
const SIZE_CLASSES = ['kit-story-size-small', 'kit-story-size-default', 'kit-story-size-large'] as const;

/**
 * A whole page (the Help viewer) in an iframe, with a stand-in for VS Code's `acquireVsCodeApi` placed under the
 * page's own nonce, so its one script runs here as it runs in a webview.
 */
function pageFrame(html: string, classes: string): HTMLElement {
  const stub = `<script nonce="${GALLERY_NONCE}">window.acquireVsCodeApi = () => ({ postMessage: (message) => console.log('posted', message) });</script>`;
  // A frame is its own document: it inherits none of the parent's --vscode-* values, so the theme fixture and the
  // theme and size classes go in with it (the page's CSP allows inline styles: `style-src 'unsafe-inline'`).
  const theme = `<style>${THEMES_CSS}${GALLERY_CSS}</style>`;
  const frame = document.createElement('iframe');
  frame.className = 'gallery-help';
  frame.title = 'Help viewer';
  frame.srcdoc = html.replace('</head>', `${theme}${stub}</head>`).replace('<body>', `<body class="${classes}">`);

  return frame;
}

/** An existing string renderer's markup (the display controls) with the CSS it ships with. */
function markup(html: string, css: string): HTMLElement {
  const holder = document.createElement('div');
  const style = document.createElement('style');
  style.textContent = css;
  const template = document.createElement('template');
  // The kit's own renderer output (zoomControlHtml / toneControlHtml escape every value they interpolate); this is
  // how the Storybook shows a string renderer, never how a component builds anything.
  template.innerHTML = html;
  holder.append(style, template.content);

  return holder;
}

export function render(entry: GalleryCase, scope?: string, classes: string = document.body.className): HTMLElement {
  switch (entry.kind) {
    case 'dom':
      return entry.render(document, scope);
    case 'html':
      return markup(entry.html, entry.css);
    case 'page':
      return pageFrame(entry.html, classes);
  }
}

/** One story's render: the case named by the story's `args.case`. */
export function renderCase(component: string): (args: { readonly case?: unknown }) => HTMLElement {
  return (args) => render(galleryCase(component, String(args.case)));
}

/** Every case of a component × the four theme kinds × the three text sizes, on one page. */
export function matrix(component: string): HTMLElement {
  const cases = GALLERY.find((entry) => entry.id === component)?.cases ?? [];
  const grid = document.createElement('div');
  grid.className = 'gallery-matrix';
  let cellNumber = 0;
  for (const entry of cases) {
    for (const theme of THEME_CLASSES) {
      for (const size of SIZE_CLASSES) {
        cellNumber += 1;
        const cell = framed(document, `${entry.title} — ${theme} — ${size}`, render(entry, `m${cellNumber}`, `${theme} ${size}`));
        cell.className = `gallery-frame ${theme} ${size}`;
        grid.append(cell);
      }
    }
  }

  return grid;
}
