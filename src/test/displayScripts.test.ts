import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DisplayConfig } from '../display/config';
import { toneColours, toneLabel, toneScript } from '../display/tone';
import { offsetLabel, scalePx, zoomScript } from '../display/zoom';
import { Node, runPageScript } from './pageHarness';

/**
 * The display controls' page scripts, RUN — a page is tested by executing it, never by reading its text.
 */

const WSL: DisplayConfig = { product: 'WSL Care', cssPrefix: 'wslcare' };

function zoomPage(handle = 'vscode') {
  const smaller = new Node({ zoom: '-1' }, 'BUTTON');
  const larger = new Node({ zoom: '1' }, 'BUTTON');
  const label = new Node({}, 'SPAN');
  const page = runPageScript(
    `const ${handle} = acquireVsCodeApi();\n${zoomScript(handle)}`,
    { 'button[data-zoom]': [smaller, larger] },
    { zoomOffset: label },
  );

  return { page, smaller, larger, label };
}

test('a zoom press posts one step in its direction and nothing else', () => {
  const { page, smaller, larger } = zoomPage();

  larger.click();
  smaller.click();

  assert.deepEqual(page.posted, [
    { type: 'zoom', delta: 1, field: '' },
    { type: 'zoom', delta: -1, field: '' },
  ]);
});

test('a page whose API handle has another name posts through that handle', () => {
  const { page, larger } = zoomPage('api');

  larger.click();

  assert.deepEqual(page.posted, [{ type: 'zoom', delta: 1, field: '' }]);
});

test('a pushed size repaints the body and the label; a message of another type changes nothing', () => {
  const { page, label } = zoomPage();

  page.message({ type: 'textTone', color: 'x', read: 'y', label: '+9' });
  assert.equal(page.body.style.fontSize, '', 'a tone message moved the size');

  page.message({ type: 'uiScale', px: scalePx(3), label: offsetLabel(3) });
  assert.equal(page.body.style.fontSize, `${scalePx(3)}px`);
  assert.equal(label.textContent, '+3');
});

function tonePage() {
  const dimmer = new Node({ tone: '-1' }, 'BUTTON');
  const brighter = new Node({ tone: '1' }, 'BUTTON');
  const label = new Node({}, 'SPAN');
  const page = runPageScript(
    `const vscode = acquireVsCodeApi();\n${toneScript(WSL)}`,
    { 'button[data-tone]': [dimmer, brighter] },
    { toneOffset: label },
  );

  return { page, dimmer, brighter, label };
}

test('a tone press posts one step in its direction', () => {
  const { page, dimmer, brighter } = tonePage();

  dimmer.click();
  brighter.click();

  assert.deepEqual(page.posted, [
    { type: 'tone', delta: -1, field: '' },
    { type: 'tone', delta: 1, field: '' },
  ]);
});

test('a pushed tone writes BOTH custom properties under the consumer prefix, and the colour', () => {
  const { page, label } = tonePage();
  const { text, read } = toneColours(2, WSL);

  page.message({ type: 'textTone', color: text, read, label: toneLabel(2) });

  assert.equal(page.body.style.custom['--wslcare-text'], text);
  assert.equal(page.body.style.custom['--wslcare-read'], read);
  assert.equal(page.body.style.color, 'var(--wslcare-text)');
  assert.equal(label.textContent, '+2');
});

test('a pushed tone of zero gives the colour back to the theme', () => {
  const { page } = tonePage();

  page.message({ type: 'textTone', color: '', read: '', label: '' });

  assert.equal(page.body.style.color, '', 'an empty colour must clear the property, not paint over the theme');
});
