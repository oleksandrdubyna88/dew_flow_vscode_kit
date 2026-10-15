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
export const Matrix = { render: () => matrix(COMPONENT) };
