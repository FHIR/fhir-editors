import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryHost, createFetchHost, createTerminologyLookup } from '../src/core/host.js';

test('MemoryHost returns copies and records saves', async () => {
  const saved = [];
  const host = new MemoryHost({ resourceType: 'CodeSystem', id: 'x' }, { onSave: r => saved.push(r) });
  const r = await host.load();
  r.id = 'changed';
  assert.equal((await host.load()).id, 'x');
  await host.save(r);
  assert.equal(host.saveCount, 1);
  assert.equal((await host.load()).id, 'changed');
  assert.equal(saved[0].id, 'changed');
});

function mockFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('createFetchHost loads and saves', async () => {
  const m = mockFetch((url, init) => {
    if (init.method === 'PUT') return json({ resourceType: 'CodeSystem', id: 'x', meta: { versionId: '2' } });
    return json({ resourceType: 'CodeSystem', id: 'x' });
  });
  try {
    const host = createFetchHost({ loadUrl: '/cs/x', saveUrl: '/cs/x', headers: { 'X-CSRF': 't' } });
    assert.equal(host.readOnly, false);
    assert.equal((await host.load()).id, 'x');
    const stored = await host.save({ resourceType: 'CodeSystem', id: 'x' });
    assert.equal(stored.meta.versionId, '2');
    assert.equal(m.calls[1].init.method, 'PUT');
    assert.equal(m.calls[1].init.headers['X-CSRF'], 't');
    assert.equal(m.calls[1].init.headers['Content-Type'], 'application/fhir+json');
  } finally {
    m.restore();
  }
});

test('createFetchHost reports OperationOutcome text on failure', async () => {
  const m = mockFetch(() => json({ resourceType: 'OperationOutcome', issue: [{ details: { text: 'Not allowed' } }] }, 403));
  try {
    const host = createFetchHost({ loadUrl: '/cs/x', saveUrl: '/cs/x' });
    await assert.rejects(host.save({ resourceType: 'CodeSystem' }), /403 Not allowed/);
  } finally {
    m.restore();
  }
});

test('createFetchHost without saveUrl is read-only', () => {
  assert.equal(createFetchHost({ loadUrl: '/x' }).readOnly, true);
});

test('terminology lookup: found, not found, cached, network failure not cached', async () => {
  let n = 0;
  let fail = false;
  const lookup = createTerminologyLookup('https://tx.example.org/r4/', {
    fetchImpl: async url => {
      n++;
      if (fail) throw new Error('offline');
      if (url.includes('code=bad')) return json({ resourceType: 'OperationOutcome', issue: [{ details: { text: 'Unknown code' } }] }, 404);
      assert.ok(url.startsWith('https://tx.example.org/r4/CodeSystem/$lookup?'));
      return json({ resourceType: 'Parameters', parameter: [{ name: 'display', valueString: 'Synonym' }] });
    }
  });
  assert.deepEqual(await lookup('http://snomed.info/sct', '900000000000013009'), { found: true, display: 'Synonym' });
  await lookup('http://snomed.info/sct', '900000000000013009');
  assert.equal(n, 1);
  assert.deepEqual(await lookup('http://snomed.info/sct', 'bad'), { found: false, message: 'Unknown code' });
  fail = true;
  assert.equal((await lookup('http://x', 'y')).unreachable, true);
  fail = false;
  assert.equal((await lookup('http://x', 'y')).found, true);
});
