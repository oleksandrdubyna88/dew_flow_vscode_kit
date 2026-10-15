import type { Preview } from '@storybook/html-vite';

import '../src/components/components.css';
import './vscode-themes.css';
import './gallery.css';

/**
 * Two toolbar globals — VS Code's theme kind and the text size — applied the way VS Code applies them to a webview:
 * the theme as the body's `vscode-*` class (`.storybook/vscode-themes.css` carries each theme's `--vscode-*` values),
 * the size as a class setting the body's font size. Story-only code: the kit's components set no class on the body
 * and no style anywhere.
 */

const THEMES: Readonly<Record<string, string>> = {
  dark: 'vscode-dark',
  light: 'vscode-light',
  'high-contrast': 'vscode-high-contrast',
  'high-contrast-light': 'vscode-high-contrast-light',
};

const SIZES: Readonly<Record<string, string>> = { small: 'kit-story-size-small', default: 'kit-story-size-default', large: 'kit-story-size-large' };

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'VS Code theme kind',
      toolbar: { title: 'Theme', icon: 'paintbrush', items: Object.keys(THEMES), dynamicTitle: true },
    },
    size: {
      description: 'Text size',
      toolbar: { title: 'Size', icon: 'zoom', items: Object.keys(SIZES), dynamicTitle: true },
    },
  },
  initialGlobals: { theme: 'dark', size: 'default' },
  decorators: [
    (story, context) => {
      const theme = THEMES[String(context.globals['theme'])] ?? 'vscode-dark';
      const size = SIZES[String(context.globals['size'])] ?? 'kit-story-size-default';
      document.body.className = `${theme} ${size}`;
      return story();
    },
  ],
  parameters: {
    a11y: { test: 'error' },
  },
};

export default preview;
