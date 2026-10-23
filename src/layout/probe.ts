/**
 * The layout probe: what the layout bin (`scripts/layout/`) asks a page, at every width x theme x text size
 * (`todo/PLAN_layout_check_bin.md` §3). Runs INSIDE the page - `scripts/build-layout.mjs` bundles it into
 * `dist/layout/probe.js` as one script the bin injects after the page has loaded - so it carries no import and reads only
 * the DOM it is given. It has no opinion about WHY a box overflows; it reports what a person would see:
 *
 * <ul>
 * <li>the page wider than the window;</li>
 * <li>an element that ends past either edge of the window;</li>
 * <li>any visible box whose content is wider than the box (a scroll bar, or text spilling out of it);</li>
 * <li>a table wider than what holds it;</li>
 * <li>opt-in <b>rows</b>: elements matching a selector that share a row (tops within {@link ROW_TOLERANCE} px of the
 *     row's first) must have one height (within {@link SLACK} px);</li>
 * <li>opt-in <b>single line</b>: the text of each element matching a selector lies on ONE line (the client rects of its
 *     text nodes share a line: tops within {@link ROW_TOLERANCE} px of the line's first, or a centre inside the line).</li>
 * </ul>
 *
 * Every finding is `{ group, where, problem }`: the gallery's section label (the nearest `data-where`, else empty), the
 * element (tag, classes and, for text, the first 40 characters), and what is wrong - never more of the page's data than that.
 * Typed against the DOM library by `tsconfig.layout.json`; the main program has none, on purpose.
 */

/** Sub-pixel rounding is not an overflow, and a 1 px difference of two heights is not a difference. */
const SLACK = 1;
/** Elements whose tops differ by no more than this are in one row (and text boxes in one line). */
const ROW_TOLERANCE = 2;
/** The most findings kept per group (a gallery case, or the page) - one broken rule can hit hundreds of elements. */
const MAX_PER_GROUP = 12;
const TEXT_CUT = 40;

export interface Finding {
  readonly group: string;
  readonly where: string;
  readonly problem: string;
}

export interface ProbeOptions {
  /** The body class of the theme to apply, e.g. `vscode-dark`. */
  readonly themeClass: string;
  /** Every theme class the bin knows, so the others are taken off the body. */
  readonly themeClasses: readonly string[];
  /** The editor font size, in px. */
  readonly fontPx: number;
  readonly rows?: string | undefined;
  readonly singleLine?: string | undefined;
}

export interface ProbeReport {
  /** How many `[data-where]` sections the page has (the gallery's case renders). */
  readonly groups: number;
  readonly findings: readonly Finding[];
  /** The option whose selector the browser could not parse, else empty. */
  readonly invalid: string;
}

declare global {
  interface Window {
    __kitLayoutProbe?: { install(css: string): void; run(options: ProbeOptions): string };
  }
}

function describe(node: Element): string {
  const classes = node.classList.length > 0 ? `.${[...node.classList].join('.')}` : '';

  return `${node.tagName.toLowerCase()}${classes}`;
}

function excerpt(node: Element): string {
  return (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, TEXT_CUT);
}

function visible(node: Element): boolean {
  return node.getClientRects().length > 0 && node.getBoundingClientRect().height > 0;
}

function groupOf(node: Element): string {
  return node.closest('[data-where]')?.getAttribute('data-where') ?? '';
}

function found(node: Element, problem: string, where: string = describe(node)): Finding {
  return { group: groupOf(node), where, problem };
}

function everything(): Element[] {
  return [...document.body.querySelectorAll('*')];
}

/** Puts the body in a theme and a text size - the way VS Code does: a class, and the font size as a variable and as the body's size. */
function apply(options: ProbeOptions): void {
  const body = document.body;
  body.classList.remove(...options.themeClasses);
  body.classList.add(options.themeClass);
  body.style.setProperty('--vscode-font-size', `${options.fontPx}px`);
  body.style.fontSize = `${options.fontPx}px`;
}

function pageFindings(): Finding[] {
  const root = document.documentElement;

  return root.scrollWidth > root.clientWidth + SLACK ? [{ group: '', where: 'the page', problem: `scrolls sideways: ${root.scrollWidth}px of ${root.clientWidth}px` }] : [];
}

/** Elements that end past either side of the window. */
function pastTheEdge(width: number): Finding[] {
  return everything().filter((node) => {
    const box = node.getBoundingClientRect();

    return visible(node) && (box.right > width + SLACK || box.left < -SLACK);
  }).map((node) => found(node, `ends at ${Math.round(node.getBoundingClientRect().right)}px of ${width}px`));
}

/** Any visible box whose content is wider than the box: a scroll bar, or text spilling out of it. */
function spilling(): Finding[] {
  return everything()
    .filter((node) => visible(node) && !node.matches('input') && node.clientWidth > 0 && node.scrollWidth > node.clientWidth + SLACK)
    .map((node) => found(node, `holds ${node.scrollWidth}px in ${node.clientWidth}px`));
}

/** A table wider than what holds it - the same defect as a spill, seen from the table. */
function widerThanParent(): Finding[] {
  return [...document.body.querySelectorAll('table')].filter(visible).flatMap((table) => {
    const room = table.parentElement?.clientWidth ?? 0;
    const used = table.getBoundingClientRect().width;

    return used > room + SLACK ? [found(table, `is ${Math.round(used)}px wide in ${room}px`)] : [];
  });
}

/** Splits `items` (sorted by `position`) into runs: an item starts a new run when it lies more than the tolerance past the run's first. */
function clusters<T>(items: readonly T[], position: (item: T) => number): T[][] {
  const runs: T[][] = [];
  for (const item of [...items].sort((a, b) => position(a) - position(b))) {
    const run = runs[runs.length - 1];
    if (run !== undefined && position(item) - position(run[0] as T) <= ROW_TOLERANCE) {
      run.push(item);
    } else {
      runs.push([item]);
    }
  }

  return runs;
}

function heightsOf(row: readonly Element[]): number[] {
  return [...new Set(row.map((node) => Math.round(node.getBoundingClientRect().height)))].sort((a, b) => a - b);
}

/** The tallest minus the shortest of the elements, in px. */
function spread(row: readonly Element[]): number {
  const heights = row.map((node) => node.getBoundingClientRect().height);

  return Math.max(...heights) - Math.min(...heights);
}

/** One row of matching elements whose heights differ by more than the slack; nothing for a row of one or of equals. */
function unequalRow(selector: string, row: readonly Element[]): Finding[] {
  const [first] = row;
  if (first === undefined || row.length < 2 || spread(row) <= SLACK) {
    return [];
  }
  const top = Math.round(first.getBoundingClientRect().top);

  return [found(first, `in one row (top ${top}px) differ in height: ${heightsOf(row).map((h) => `${h}px`).join(' and ')}`, selector)];
}

function rowFindings(selector: string): Finding[] {
  const matching = [...document.querySelectorAll(selector)].filter(visible);

  return clusters(matching, (node) => node.getBoundingClientRect().top).flatMap((row) => unequalRow(selector, row));
}

/** The client rects of the element's own text nodes - one per line each occupies. */
function textRects(node: Element): DOMRect[] {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const rects: DOMRect[] = [];
  for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
    if ((text.nodeValue ?? '').trim() !== '') {
      const range = document.createRange();
      range.selectNodeContents(text);
      rects.push(...[...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0));
    }
  }

  return rects;
}

/** A text box belongs to the line when its top is within the tolerance of the line's first top, or its vertical centre lies inside the line. */
function onLine(line: { readonly top: number; readonly bottom: number }, rect: DOMRect): boolean {
  return rect.top - line.top <= ROW_TOLERANCE || rect.top + rect.height / 2 <= line.bottom;
}

/**
 * How many lines the text boxes occupy. Tops alone are not enough: a badge in a smaller font, vertically centred, sits
 * several px lower than the text beside it on the SAME line (measured: text top 8 px, badge text top 11.6 px), while the
 * next line's box has its centre below the line's bottom edge - so the centre decides when the tops do not agree.
 */
function linesOf(node: Element): number {
  const lines: { top: number; bottom: number }[] = [];
  for (const rect of textRects(node).sort((a, b) => a.top - b.top)) {
    const line = lines[lines.length - 1];
    if (line !== undefined && onLine(line, rect)) {
      line.bottom = Math.max(line.bottom, rect.bottom);
    } else {
      lines.push({ top: rect.top, bottom: rect.bottom });
    }
  }

  return lines.length;
}

function wrapped(node: Element): Finding[] {
  const lines = linesOf(node);

  return lines > 1 ? [found(node, `wraps onto ${lines} lines`, `${describe(node)} "${excerpt(node)}"`)] : [];
}

function singleLineFindings(selector: string): Finding[] {
  return [...document.querySelectorAll(selector)].filter(visible).flatMap(wrapped);
}

/** The option whose selector the browser cannot parse, else empty. */
function invalidSelector(options: ProbeOptions): string {
  for (const [name, selector] of [['rows', options.rows], ['singleLine', options.singleLine]] as const) {
    try {
      document.querySelector(selector ?? '*');
    } catch {
      return name;
    }
  }

  return '';
}

/** At most MAX_PER_GROUP findings per group, in the order found. */
function capped(findings: readonly Finding[]): Finding[] {
  const counts = new Map<string, number>();

  return findings.filter((finding) => {
    const seen = (counts.get(finding.group) ?? 0) + 1;
    counts.set(finding.group, seen);

    return seen <= MAX_PER_GROUP;
  });
}

function measure(options: ProbeOptions): Finding[] {
  const width = document.documentElement.clientWidth;

  return [
    ...pageFindings(), ...pastTheEdge(width), ...spilling(), ...widerThanParent(),
    ...(options.rows === undefined ? [] : rowFindings(options.rows)),
    ...(options.singleLine === undefined ? [] : singleLineFindings(options.singleLine)),
  ];
}

function run(options: ProbeOptions): string {
  const invalid = invalidSelector(options);
  const groups = document.querySelectorAll('[data-where]').length;
  if (invalid !== '') {
    return JSON.stringify({ groups, findings: [], invalid } satisfies ProbeReport);
  }
  apply(options);

  return JSON.stringify({ groups, findings: capped(measure(options)), invalid } satisfies ProbeReport);
}

/** The stylesheet is adopted, not inserted as a `<style>` element, so a page's own Content-Security-Policy cannot refuse it. */
function install(css: string): void {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}

window.__kitLayoutProbe = { install, run };
