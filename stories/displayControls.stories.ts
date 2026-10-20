import { matrix, renderCase } from './story';

/**
 * The ± text size and ± text tone controls (`display/zoom.ts`, `display/tone.ts`) as they exist — byte-compatible with
 * ConnectOtherAIs, shown here, not rewritten. `src/test/stories.test.ts` holds the list.
 */
const COMPONENT = 'displayControls';

export default { title: 'Existing/Display controls', render: renderCase(COMPONENT) };

export const SmallestDimmest = { args: { case: 'smallest-dimmest' } };
export const ThemeDefault = { args: { case: 'theme-default' } };
export const LargestBrightest = { args: { case: 'largest-brightest' } };
export const Matrix = { render: () => matrix(COMPONENT) };
