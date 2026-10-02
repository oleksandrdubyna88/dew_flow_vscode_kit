import assert from 'node:assert/strict';
import { test } from 'node:test';

import { settingWritten, type SettingNotSaved } from '../settings/settingWritten';

test('a write that succeeded reports nothing', async () => {
  const told: SettingNotSaved[] = [];

  await settingWritten(Promise.resolve(), 'help', async (notice) => {
    told.push(notice);
  });

  assert.deepEqual(told, []);
});

test('a write that failed is reported once, naming the surface and the reason', async () => {
  const told: SettingNotSaved[] = [];

  await settingWritten(Promise.reject(new Error('read-only settings file')), 'chat', async (notice) => {
    told.push(notice);
  });

  assert.equal(told.length, 1);
  assert.deepEqual(told[0], {
    source: 'chat',
    code: 'view-setting-not-saved',
    title: 'That view setting could not be saved: Error: read-only settings file',
    detail: 'Error: read-only settings file',
  });
});

test('a rejection that is not an Error is still a readable reason, never a crash', async () => {
  const told: SettingNotSaved[] = [];

  await settingWritten(Promise.reject(undefined), 'help', async (notice) => {
    told.push(notice);
  });

  assert.equal(told[0]?.detail, '');
  assert.equal(told[0]?.title, 'That view setting could not be saved: ');
});
