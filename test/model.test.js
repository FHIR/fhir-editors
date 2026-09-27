import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getConcept, walk, countConcepts, insertConcept, insertSiblingAfter, removeConcept,
  moveConcept, indentConcept, outdentConcept, reparentConcept, uniqueCode, searchConcepts,
  renameCode, propertyUsage, renamePropertyDefinition, changePropertyType,
  parsePropertyValue, normalize, valueKeyForType, typeOfValueKey
} from '../src/codesystem/model.js';
import { orderKeys, prune } from '../src/core/fhir-json.js';

function sample() {
  return {
    resourceType: 'CodeSystem',
    status: 'draft',
    content: 'complete',
    property: [{ code: 'parent', type: 'code' }, { code: 'weight', type: 'integer' }],
    concept: [
      { code: 'a', display: 'A', concept: [{ code: 'a1' }, { code: 'a2', property: [{ code: 'parent', valueCode: 'a' }] }] },
      { code: 'b', display: 'B', property: [{ code: 'weight', valueInteger: 3 }] },
      { code: 'c' }
    ]
  };
}

const codes = cs => { const r = []; walk(cs, (c, p, d) => r.push('  '.repeat(d) + c.code)); return r; };

test('getConcept and walk', () => {
  const cs = sample();
  assert.equal(getConcept(cs, [0, 1]).code, 'a2');
  assert.equal(getConcept(cs, [5]), undefined);
  assert.deepEqual(codes(cs), ['a', '  a1', '  a2', 'b', 'c']);
  assert.equal(countConcepts(cs), 5);
});

test('insert and remove', () => {
  const cs = sample();
  assert.deepEqual(insertConcept(cs, [2], { code: 'c1' }), [2, 0]);
  assert.deepEqual(insertSiblingAfter(cs, [0], { code: 'ab' }), [1]);
  assert.deepEqual(codes(cs), ['a', '  a1', '  a2', 'ab', 'b', 'c', '  c1']);
  removeConcept(cs, [3, 0]);
  assert.equal(getConcept(cs, [3]).concept, undefined, 'empty child array is removed');
});

test('move, indent, outdent', () => {
  const cs = sample();
  assert.deepEqual(moveConcept(cs, [1], -1), [0]);
  assert.deepEqual(codes(cs), ['b', 'a', '  a1', '  a2', 'c']);
  assert.equal(moveConcept(cs, [0], -1), null);
  assert.deepEqual(indentConcept(cs, [2]), [1, 2]);
  assert.deepEqual(codes(cs), ['b', 'a', '  a1', '  a2', '  c']);
  assert.equal(indentConcept(cs, [0]), null);
  assert.deepEqual(outdentConcept(cs, [1, 0]), [2]);
  assert.deepEqual(codes(cs), ['b', 'a', '  a2', '  c', 'a1']);
  assert.equal(outdentConcept(cs, [0]), null);
});

test('reparent adjusts for removal shifts and refuses cycles', () => {
  const cs = sample();
  assert.equal(reparentConcept(cs, [0], [0, 1]), null);
  // move 'a' under 'c': c's index shifts from 2 to 1 once a is removed
  assert.deepEqual(reparentConcept(cs, [0], [2]), [1, 0]);
  assert.deepEqual(codes(cs), ['b', 'c', '  a', '    a1', '    a2']);
  // to top level, at an index after itself
  const cs2 = sample();
  assert.deepEqual(reparentConcept(cs2, [0], [], 3), [2]);
  assert.deepEqual(codes(cs2).filter(c => !c.startsWith(' ')), ['b', 'c', 'a']);
});

test('uniqueCode respects case sensitivity', () => {
  const cs = sample();
  insertConcept(cs, [], { code: 'New-1' });
  assert.equal(uniqueCode(cs), 'new-1');
  cs.caseSensitive = false;
  assert.equal(uniqueCode(cs), 'new-2');
});

test('search', () => {
  const cs = sample();
  assert.deepEqual(searchConcepts(cs, 'A2'), [[0, 1]]);
  assert.deepEqual(searchConcepts(cs, ' '), []);
});

test('renameCode updates code-typed references', () => {
  const cs = sample();
  assert.equal(renameCode(cs, [0], 'alpha'), 1);
  assert.equal(getConcept(cs, [0, 1]).property[0].valueCode, 'alpha');
});

test('property definitions: usage, rename, change type', () => {
  const cs = sample();
  assert.equal(propertyUsage(cs).get('weight'), 1);
  renamePropertyDefinition(cs, 'weight', 'w');
  assert.equal(getConcept(cs, [1]).property[0].code, 'w');
  changePropertyType(cs, 'w', 'string');
  assert.deepEqual(getConcept(cs, [1]).property[0], { code: 'w', valueString: '3' });
  changePropertyType(cs, 'w', 'boolean');
  assert.deepEqual(getConcept(cs, [1]).property[0], { code: 'w', valueString: '3' }, 'unconvertible value is left alone');
  changePropertyType(cs, 'parent', 'Coding');
  assert.deepEqual(getConcept(cs, [0, 1]).property[0], { code: 'parent', valueCoding: { code: 'a' } });
});

test('value keys', () => {
  assert.equal(valueKeyForType('code'), 'valueCode');
  assert.equal(valueKeyForType('Coding'), 'valueCoding');
  assert.equal(valueKeyForType('dateTime'), 'valueDateTime');
  assert.equal(typeOfValueKey('valueCoding'), 'Coding');
  assert.equal(typeOfValueKey('valueDateTime'), 'dateTime');
});

test('parsePropertyValue', () => {
  assert.deepEqual(parsePropertyValue('integer', '12'), { value: 12 });
  assert.ok(parsePropertyValue('integer', '1.5').error);
  assert.deepEqual(parsePropertyValue('decimal', '1.50'), { value: 1.5 });
  assert.deepEqual(parsePropertyValue('boolean', 'false'), { value: false });
  assert.ok(parsePropertyValue('boolean', 'yes').error);
});

test('orderKeys handles choice types, _elements and similar names', () => {
  const o = orderKeys({ copyrightLabel: 'x', versionAlgorithmString: 's', _status: {}, status: 'draft', copyright: 'c', version: '1', foo: 1 },
    ['version', 'versionAlgorithm', 'status', 'copyright', 'copyrightLabel']);
  assert.deepEqual(Object.keys(o), ['version', 'versionAlgorithmString', 'status', '_status', 'copyright', 'copyrightLabel', 'foo']);
});

test('prune removes empties but keeps false and 0', () => {
  assert.deepEqual(prune({ a: '', b: [], c: {}, d: false, e: 0, f: [{ x: '' }], g: 'y' }), { d: false, e: 0, g: 'y' });
});

test('normalize orders and prunes without changing the input', () => {
  const cs = { concept: [{ display: 'X', code: 'x', designation: [{ value: 'v', language: 'fr' }] }], status: 'draft', resourceType: 'CodeSystem', url: '', extension: [{ url: 'http://e', valueString: 's' }] };
  const n = normalize(cs);
  assert.deepEqual(Object.keys(n), ['resourceType', 'extension', 'status', 'concept']);
  assert.deepEqual(Object.keys(n.concept[0]), ['code', 'display', 'designation']);
  assert.deepEqual(Object.keys(n.concept[0].designation[0]), ['language', 'value']);
  assert.equal(cs.url, '', 'input unchanged');
});

test('retargetCodeReferences leaves references alone while the old code is still in use', async () => {
  const { retargetCodeReferences } = await import('../src/codesystem/model.js');
  const cs = sample();
  cs.concept.push({ code: 'a' });
  assert.equal(retargetCodeReferences(cs, 'a', 'x'), 0);
  cs.concept.pop();
  cs.concept[0].code = 'x';
  assert.equal(retargetCodeReferences(cs, 'a', 'x'), 1);
});

test('renamePropertyDefinition with a duplicate definition does not touch concepts', () => {
  const cs = sample();
  cs.property.push({ code: 'weight', type: 'string' });
  renamePropertyDefinition(cs, 'weight', 'w2', 2);
  assert.equal(getConcept(cs, [1]).property[0].code, 'weight');
  assert.equal(cs.property[2].code, 'w2');
});

test('renaming a code does not change status values that happen to match it', () => {
  const cs = sample();
  cs.property.push({ code: 'status', uri: 'http://hl7.org/fhir/concept-properties#status', type: 'code' });
  cs.concept[2].code = 'retired';
  cs.concept[1].property.push({ code: 'status', valueCode: 'retired' });
  renameCode(cs, [2], 'old');
  assert.equal(cs.concept[1].property[1].valueCode, 'retired');
});

test('setSingleProperty adds, replaces and removes', async () => {
  const { setSingleProperty, propertyValues } = await import('../src/codesystem/model.js');
  const cs = sample();
  setSingleProperty(cs, [2], 'weight', 'integer', 7);
  assert.deepEqual(getConcept(cs, [2]).property, [{ code: 'weight', valueInteger: 7 }]);
  getConcept(cs, [2]).property[0].extension = [{ url: 'http://x', valueString: 'y' }];
  setSingleProperty(cs, [2], 'weight', 'string', 'eight');
  assert.deepEqual(getConcept(cs, [2]).property, [{ code: 'weight', extension: [{ url: 'http://x', valueString: 'y' }], valueString: 'eight' }]);
  setSingleProperty(cs, [2], 'weight', 'string', undefined);
  assert.equal(getConcept(cs, [2]).property, undefined);
  assert.equal(propertyValues(getConcept(cs, [1]), 'weight').length, 1);
});
