import { matrix, renderCase } from './story';

/** RecommendationCard — one story per gallery case (`src/test/gallery/`), and the matrix. `src/test/stories.test.ts` holds the list. */
const COMPONENT = 'recommendationCard';

export default { title: 'Components/RecommendationCard', render: renderCase(COMPONENT) };

export const Neutral = { args: { case: 'neutral' } };
export const Info = { args: { case: 'info' } };
export const Ok = { args: { case: 'ok' } };
export const Warning = { args: { case: 'warning' } };
export const Critical = { args: { case: 'critical' } };
export const WithAction = { args: { case: 'with-action' } };
export const SentenceOnly = { args: { case: 'sentence-only' } };
export const Matrix = { render: () => matrix(COMPONENT) };
