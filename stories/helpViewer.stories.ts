import { matrix, renderCase } from './story';

/**
 * The Help viewer (`help/page.ts`) as it exists — byte-compatible with ConnectOtherAIs, shown in a frame with its own
 * script running, not rewritten. `src/test/stories.test.ts` holds the list.
 */
const COMPONENT = 'helpViewer';

export default { title: 'Existing/Help viewer', render: renderCase(COMPONENT) };

export const English = { args: { case: 'english' } };
export const TranslatedAndStale = { args: { case: 'translated-and-stale' } };
export const Fallback = { args: { case: 'fallback' } };
export const Matrix = { render: () => matrix(COMPONENT) };
