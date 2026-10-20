import type { StorybookConfig } from '@storybook/html-vite';

/**
 * The kit's Storybook (`todo/PLAN_kit_components_storybook.md` §4.9): every component × state, under VS Code's four
 * reference themes and three text sizes, with axe's panel (`addon-a11y`) beside it. A devDependency only — nothing
 * here or in `stories/` ships (`files` is `dist` and the digests bin). Telemetry is off: a build run by CI or by a
 * person reports nothing anywhere.
 */
const config: StorybookConfig = {
  framework: { name: '@storybook/html-vite', options: {} },
  stories: ['../stories/*.stories.ts'],
  addons: ['@storybook/addon-a11y'],
  core: { disableTelemetry: true },
};

export default config;
