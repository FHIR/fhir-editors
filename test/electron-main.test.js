import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { registerEditorHandlers, CHANNELS } = require('../hosts/electron/main.cjs');
const { CHANNELS: RENDERER_CHANNELS } = await import('../src/core/electron-host.js');

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handle: (ch, fn) => handlers.set(ch, fn),
    removeHandler: ch => handlers.delete(ch),
    invoke: (ch, ...args) => handlers.get(ch)({}, ...args),
    handlers
  };
}

test('renderer and main agree on channel names', () => {
  assert.deepEqual(RENDERER_CHANNELS, CHANNELS);
});

test('read then write, atomically, within roots only', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-'));
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-other-'));
  const file = path.join(dir, 'CodeSystem-x.json');
  fs.writeFileSync(file, '﻿{"resourceType":"CodeSystem"}');
  const ipc = fakeIpcMain();
  const reg = registerEditorHandlers(ipc, { roots: () => [dir] });

  assert.equal(await ipc.invoke(CHANNELS.read, file), '{"resourceType":"CodeSystem"}', 'BOM stripped');
  await ipc.invoke(CHANNELS.write, file, '{"resourceType":"CodeSystem","id":"x"}\n');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).id, 'x');
  assert.deepEqual(fs.readdirSync(dir), ['CodeSystem-x.json'], 'no temp files left');

  await assert.rejects(ipc.invoke(CHANNELS.write, file, 'not json'));
  const unread = path.join(dir, 'CodeSystem-y.json');
  await assert.rejects(ipc.invoke(CHANNELS.write, unread, '{}'), /has not been opened/);
  reg.allow(unread);
  await ipc.invoke(CHANNELS.write, unread, '{}');

  const outside = path.join(other, 'a.json');
  fs.writeFileSync(outside, '{}');
  await assert.rejects(ipc.invoke(CHANNELS.read, outside), /not in a folder/);
  await assert.rejects(ipc.invoke(CHANNELS.read, path.join(dir, '..', path.basename(other), 'a.json')), /not in a folder/);
  await assert.rejects(ipc.invoke(CHANNELS.read, path.join(dir, 'x.txt')), /Only .json/);
  await assert.rejects(ipc.invoke(CHANNELS.read, 'relative.json'), /absolute/);

  reg.dispose();
  assert.equal(ipc.handlers.size, 0);
});

test('createElectronHost uses the given ipc', async () => {
  const { createElectronHost } = await import('../src/core/electron-host.js');
  const calls = [];
  const ipc = { invoke: async (ch, ...args) => { calls.push([ch, ...args]); return '{"resourceType":"CodeSystem"}'; } };
  const host = createElectronHost({ file: '/x/cs.json', ipc });
  assert.equal((await host.load()).resourceType, 'CodeSystem');
  await host.save({ resourceType: 'CodeSystem' });
  assert.equal(calls[1][0], 'fhir-editors:write');
  assert.equal(calls[1][2], '{\n  "resourceType": "CodeSystem"\n}\n');
  assert.throws(() => createElectronHost({ file: '/x' }), /no IPC channel/);
});
