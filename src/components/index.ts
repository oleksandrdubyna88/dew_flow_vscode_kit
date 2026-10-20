/**
 * `@oleksandrdubyna88/vscode-webview-kit/components` — the webview components, as of 0.2.0
 * (`todo/PLAN_kit_components_storybook.md`).
 *
 * <p>A SEPARATE entry from the package root on purpose: these run INSIDE a webview, bundled by the consumer for the
 * browser, and the root entry re-exports the host's nonce, which imports `node:crypto`. Nothing reachable from this
 * file imports anything outside `src/components/` — `src/test/architecture.test.ts` holds that — and nothing here
 * imports `vscode`. Their stylesheet is `@oleksandrdubyna88/vscode-webview-kit/components.css`.</p>
 *
 * <p>Every component takes the document it builds in as its first argument (`dom.ts`): the real `document` in a
 * webview, a strict fake or jsdom in a test. `src/test/exports.test.ts` pins this list.</p>
 */

export type { KitDocument, KitElement, KitEvent, KitEventType, KitTag } from './dom';
export { STATUS_TONES, type StatusMark, type StatusTone } from './status';
export { createTabs, type TabSpec, type TabsOptions, type TabsView } from './tabs';
export type { CellValue, SortDirection } from './tableOrder';
export {
  createDataTable,
  type DataColumn,
  type DataTableOptions,
  type DataTableReveal,
  type DataTableSort,
  type DataTableView,
  type StackWidth,
} from './dataTable';
export { createRecommendationCard, type RecommendationOptions } from './recommendationCard';
