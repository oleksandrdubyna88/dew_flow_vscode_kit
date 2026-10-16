import { matrix, renderCase } from './story';

/** Tabs — one story per gallery case (`src/test/gallery/`), and the matrix. `src/test/stories.test.ts` holds the list. */
const COMPONENT = 'tabs';

export default { title: 'Components/Tabs', render: renderCase(COMPONENT) };

export const Default = { args: { case: 'default' } };
export const EveryTone = { args: { case: 'every-tone' } };
export const SecondSelected = { args: { case: 'second-selected' } };
export const Many = { args: { case: 'many' } };
export const Matrix = { render: () => matrix(COMPONENT) };
