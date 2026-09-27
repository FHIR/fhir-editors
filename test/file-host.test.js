import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFileHandleHost } from '../src/core/file-host.js';

function fakeHandle(text, { permission = 'granted', grant = 'granted' } = {}) {
  const h = {
    name: 'CodeSystem-x.json',
    text,
    requested: 0,
    async getFile() { return { text: async () => h.text }; },
    async queryPermission() { return permission; },
    async requestPermission() { h.requested++; return grant; },
    async createWritable() {
      let buf = '';
      return { write: async s => { buf += s; }, close: async () => { h.text = buf; }, abort: async () => {} };
    }
  };
  return h;
}

test('file handle host loads (ignoring a BOM) and saves pretty JSON', async () => {
  const h = fakeHandle('﻿{"resourceType":"CodeSystem","id":"x"}');
  const host = createFileHandleHost(h);
  assert.equal(host.label, 'CodeSystem-x.json');
  assert.equal((await host.load()).id, 'x');
  await host.save({ resourceType: 'CodeSystem', id: 'y' });
  assert.equal(h.text, '{\n  "resourceType": "CodeSystem",\n  "id": "y"\n}\n');
  assert.equal(h.requested, 0);
});

test('file handle host asks for permission again, and fails if refused', async () => {
  const ok = fakeHandle('{}', { permission: 'prompt', grant: 'granted' });
  await createFileHandleHost(ok).save({ resourceType: 'CodeSystem' });
  assert.equal(ok.requested, 1);
  const no = fakeHandle('{}', { permission: 'prompt', grant: 'denied' });
  await assert.rejects(createFileHandleHost(no).save({ resourceType: 'CodeSystem' }), /not granted/);
  assert.equal(no.text, '{}');
});

test('file handle host reports bad JSON with the file name', async () => {
  await assert.rejects(createFileHandleHost(fakeHandle('{ nope')).load(), /CodeSystem-x.json is not valid JSON/);
});
