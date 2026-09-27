import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCodeSystem } from '../src/codesystem/validation.js';

function good() {
  return {
    resourceType: 'CodeSystem',
    id: 'test',
    url: 'http://example.org/fhir/CodeSystem/test',
    name: 'TestCodes',
    status: 'draft',
    content: 'complete',
    caseSensitive: true,
    property: [{ code: 'parent', uri: 'http://hl7.org/fhir/concept-properties#parent', type: 'code' }],
    concept: [
      { code: 'a', display: 'A' },
      { code: 'b', display: 'B', property: [{ code: 'parent', valueCode: 'a' }] }
    ]
  };
}

const messages = cs => validateCodeSystem(cs).map(i => `${i.severity}: ${i.message}`);

test('a good code system has no issues', () => {
  assert.deepEqual(messages(good()), []);
});

test('metadata checks', () => {
  const cs = good();
  delete cs.status;
  cs.url = 'not a url';
  cs.name = 'bad name';
  cs.id = 'bad id';
  const m = messages(cs);
  assert.ok(m.some(s => s.startsWith('error: status is required')));
  assert.ok(m.some(s => s.includes('not an absolute URI')));
  assert.ok(m.some(s => s.startsWith('warning: The name')));
  assert.ok(m.some(s => s.includes('The id "bad id"')));
});

test('content and supplements consistency', () => {
  const cs = good();
  cs.content = 'supplement';
  assert.ok(messages(cs).some(s => s.includes('must say which code system')));
  cs.content = 'complete';
  cs.supplements = 'http://x';
  assert.ok(messages(cs).some(s => s.includes('must be "supplement"')));
  delete cs.supplements;
  cs.count = 5;
  assert.ok(messages(cs).some(s => s.includes('count is 5 but there are 2')));
});

test('duplicate codes, respecting caseSensitive', () => {
  const cs = good();
  cs.concept.push({ code: 'A', display: 'Upper A' });
  assert.deepEqual(messages(cs), []);
  cs.caseSensitive = false;
  const dups = validateCodeSystem(cs).filter(i => i.message.includes('more than once'));
  assert.equal(dups.length, 2);
  assert.deepEqual(dups.map(d => d.conceptPath), [[0], [2]]);
});

test('whitespace in codes', () => {
  const cs = good();
  cs.concept[0].code = ' a';
  assert.ok(messages(cs).some(s => s.includes('whitespace')));
});

test('concept property checks', () => {
  const cs = good();
  cs.concept[0].property = [
    { code: 'undeclared', valueString: 'x' },
    { code: 'parent', valueString: 'a' },
    { code: 'parent' }
  ];
  cs.concept[1].property[0].valueCode = 'zzz';
  const m = messages(cs);
  assert.ok(m.some(s => s.includes('"undeclared" on concept "a" is not defined')));
  assert.ok(m.some(s => s.includes('is a string, but is defined as code')));
  assert.ok(m.some(s => s.includes('has no value')));
  assert.ok(m.some(s => s.startsWith('warning:') && s.includes('"zzz", which is not a code')));
});

test('property definition checks', () => {
  const cs = good();
  cs.property.push({ code: 'parent', type: 'code' }, { code: 'x', type: 'text' });
  cs.property[0].type = 'string';
  const m = messages(cs);
  assert.ok(m.some(s => s.includes('defined more than once')));
  assert.ok(m.some(s => s.includes('unknown type "text"')));
  assert.ok(m.some(s => s.includes('is defined with type code, not string')));
});

test('filter checks', () => {
  const cs = good();
  cs.filter = [{ code: 'f', operator: ['=', 'bogus'] }];
  const m = messages(cs);
  assert.ok(m.some(s => s.includes('unknown operator "bogus"')));
  assert.ok(m.some(s => s.includes('no value description')));
});

test('designations', () => {
  const cs = good();
  cs.concept[0].designation = [{ language: 'not_a_lang!', value: 'x' }, { language: 'fr' }];
  const m = messages(cs);
  assert.ok(m.some(s => s.includes('does not look like a valid language')));
  assert.ok(m.some(s => s.includes('designation on concept "a" has no value')));
});

test('wrong resource type stops early', () => {
  assert.deepEqual(messages({ resourceType: 'ValueSet' }), ['error: resourceType must be CodeSystem, not ValueSet']);
});

test('status property values are not treated as concept references', () => {
  const cs = good();
  cs.property.push({ code: 'status', uri: 'http://hl7.org/fhir/concept-properties#status', type: 'code' });
  cs.concept[0].property = [{ code: 'status', valueCode: 'retired' }];
  assert.deepEqual(messages(cs), []);
});
