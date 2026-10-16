import { matrix, renderCase } from './story';

/** DataTable — one story per gallery case (`src/test/gallery/`), and the matrix. `src/test/stories.test.ts` holds the list. */
const COMPONENT = 'dataTable';

export default { title: 'Components/DataTable', render: renderCase(COMPONENT) };

export const Unsorted = { args: { case: 'unsorted' } };
export const SortedAscending = { args: { case: 'sorted-ascending' } };
export const SortedDescending = { args: { case: 'sorted-descending' } };
export const Searched = { args: { case: 'searched' } };
export const SearchedNone = { args: { case: 'searched-none' } };
export const Revealed = { args: { case: 'revealed' } };
export const Plain = { args: { case: 'plain' } };
export const Empty = { args: { case: 'empty' } };
export const EightColumns = { args: { case: 'eight-columns' } };
export const UnbreakableCell = { args: { case: 'unbreakable-cell' } };
export const LongHeader = { args: { case: 'long-header' } };
export const StackNarrow = { args: { case: 'stack-narrow' } };
export const StackMedium = { args: { case: 'stack-medium' } };
export const StackWide = { args: { case: 'stack-wide' } };
export const StackNever = { args: { case: 'stack-never' } };
export const Matrix = { render: () => matrix(COMPONENT) };
