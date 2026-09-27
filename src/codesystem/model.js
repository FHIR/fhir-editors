// CodeSystem operations on plain JSON. No DOM - everything here is testable in node.
//
// Concepts are addressed by a path: an array of indexes from the top of the
// concept hierarchy, e.g. [2, 0] is the first child of the third top-level concept.

import { orderKeys, prune } from '../core/fhir-json.js';

export const CODESYSTEM_ORDER = [
  'resourceType', 'id', 'meta', 'implicitRules', 'language', 'text', 'contained',
  'extension', 'modifierExtension', 'url', 'identifier', 'version', 'versionAlgorithm',
  'name', 'title', 'status', 'experimental', 'date', 'publisher', 'contact',
  'description', 'useContext', 'jurisdiction', 'purpose', 'copyright', 'copyrightLabel',
  'approvalDate', 'lastReviewDate', 'effectivePeriod', 'topic', 'author', 'editor',
  'reviewer', 'endorser', 'relatedArtifact', 'caseSensitive', 'valueSet',
  'hierarchyMeaning', 'compositional', 'versionNeeded', 'content', 'supplements',
  'count', 'filter', 'property', 'concept'
];
const CONCEPT_ORDER = ['id', 'extension', 'modifierExtension', 'code', 'display', 'definition', 'designation', 'property', 'concept'];
const DESIGNATION_ORDER = ['id', 'extension', 'modifierExtension', 'language', 'use', 'additionalUse', 'value'];
const CONCEPT_PROPERTY_ORDER = ['id', 'extension', 'modifierExtension', 'code', 'value'];
const PROPERTY_ORDER = ['id', 'extension', 'modifierExtension', 'code', 'uri', 'description', 'type'];
const FILTER_ORDER = ['id', 'extension', 'modifierExtension', 'code', 'description', 'operator', 'value'];

export const STATUS_CODES = ['draft', 'active', 'retired', 'unknown'];
export const CONTENT_CODES = ['not-present', 'example', 'fragment', 'complete', 'supplement'];
export const HIERARCHY_CODES = ['grouped-by', 'is-a', 'part-of', 'classified-with'];
export const PROPERTY_TYPES = ['code', 'Coding', 'string', 'integer', 'boolean', 'dateTime', 'decimal'];
export const FILTER_OPERATORS = ['=', 'is-a', 'descendent-of', 'is-not-a', 'regex', 'in', 'not-in',
  'generalizes', 'child-of', 'descendent-leaf', 'exists'];

/** The value[x] element name used for a property of the given type */
export function valueKeyForType(type) {
  return 'value' + type.charAt(0).toUpperCase() + type.slice(1);
}

/** The value[x] key present on a concept property, if any */
export function valueKeyOf(prop) {
  return Object.keys(prop).find(k => k.startsWith('value') && k.length > 5 && /^[A-Z]/.test(k[5]));
}

/** A property's type, from its value[x] key (valueCode -> code, valueCoding -> Coding) */
export function typeOfValueKey(key) {
  const t = key.slice(5);
  return t === 'Coding' ? 'Coding' : t.charAt(0).toLowerCase() + t.slice(1);
}

/** A minimal new CodeSystem */
export function newCodeSystem() {
  return {
    resourceType: 'CodeSystem',
    status: 'draft',
    content: 'complete',
    caseSensitive: true,
    concept: []
  };
}

/**
 * Whether a property definition's values are references to other concepts in
 * this code system. Most code-typed properties are (parent, child, partOf,
 * synonym, and most locally defined ones), but the standard status property is
 * a code from its own value set (active, retired...), not a concept reference.
 */
export function isConceptReferenceProperty(def) {
  if (!def || def.type !== 'code') return false;
  if (def.uri) return def.uri !== 'http://hl7.org/fhir/concept-properties#status';
  return def.code !== 'status';
}

// --- concept tree ---------------------------------------------------------

/** The array that holds the children of the concept at parentPath ([] = top level). Created if absent when create is true. */
export function childrenOf(cs, parentPath, create = false) {
  if (parentPath.length === 0) {
    if (!cs.concept && create) cs.concept = [];
    return cs.concept || [];
  }
  const parent = getConcept(cs, parentPath);
  if (!parent) return [];
  if (!parent.concept && create) parent.concept = [];
  return parent.concept || [];
}

export function getConcept(cs, path) {
  let list = cs.concept || [];
  let c;
  for (const i of path) {
    c = list[i];
    if (!c) return undefined;
    list = c.concept || [];
  }
  return c;
}

/** Calls fn(concept, path, depth) for every concept, depth first, in document order. */
export function walk(cs, fn) {
  const visit = (list, prefix) => {
    list.forEach((c, i) => {
      const path = [...prefix, i];
      fn(c, path, prefix.length);
      if (c.concept) visit(c.concept, path);
    });
  };
  visit(cs.concept || [], []);
}

export function countConcepts(cs) {
  let n = 0;
  walk(cs, () => n++);
  return n;
}

function tidyChildren(concept) {
  if (concept && Array.isArray(concept.concept) && concept.concept.length === 0) delete concept.concept;
}

/** Inserts a concept into the children of parentPath at index (default: end). Returns its path. */
export function insertConcept(cs, parentPath, concept, index) {
  const list = childrenOf(cs, parentPath, true);
  const at = index === undefined ? list.length : Math.max(0, Math.min(index, list.length));
  list.splice(at, 0, concept);
  return [...parentPath, at];
}

/** Adds a new sibling after the concept at path. Returns the new path. */
export function insertSiblingAfter(cs, path, concept) {
  return insertConcept(cs, path.slice(0, -1), concept, path[path.length - 1] + 1);
}

/** Removes the concept (and its descendants). Returns the removed concept. */
export function removeConcept(cs, path) {
  const parentPath = path.slice(0, -1);
  const list = childrenOf(cs, parentPath);
  const [removed] = list.splice(path[path.length - 1], 1);
  if (parentPath.length) tidyChildren(getConcept(cs, parentPath));
  return removed;
}

/** Swaps the concept with its previous (delta=-1) or next (delta=1) sibling. Returns the new path, or null if it can't move. */
export function moveConcept(cs, path, delta) {
  const list = childrenOf(cs, path.slice(0, -1));
  const i = path[path.length - 1];
  const j = i + delta;
  if (j < 0 || j >= list.length) return null;
  [list[i], list[j]] = [list[j], list[i]];
  return [...path.slice(0, -1), j];
}

/** Makes the concept the last child of its previous sibling. Returns the new path, or null. */
export function indentConcept(cs, path) {
  const i = path[path.length - 1];
  if (i === 0) return null;
  const parentPath = path.slice(0, -1);
  const concept = removeConcept(cs, path);
  return insertConcept(cs, [...parentPath, i - 1], concept);
}

/** Makes the concept the next sibling of its parent. Returns the new path, or null. */
export function outdentConcept(cs, path) {
  if (path.length < 2) return null;
  const parentPath = path.slice(0, -1);
  const concept = removeConcept(cs, path);
  return insertSiblingAfter(cs, parentPath, concept);
}

/**
 * Moves the concept at from to become a child of the concept at toParent
 * (at index, default end). Refuses to move a concept into its own subtree.
 * Returns the new path, or null.
 */
export function reparentConcept(cs, from, toParent, index) {
  if (toParent.length >= from.length && from.every((v, i) => toParent[i] === v)) return null;
  const concept = getConcept(cs, from);
  if (!concept) return null;
  // Removing 'from' shifts later siblings; adjust the target path if it passes through them
  const target = [...toParent];
  const depth = from.length - 1;
  const sameParentPrefix = target.length > depth && from.slice(0, depth).every((v, i) => target[i] === v);
  if (sameParentPrefix && target[depth] > from[depth]) target[depth]--;
  let at = index;
  if (at !== undefined && target.length === depth && from.slice(0, depth).every((v, i) => target[i] === v) && at > from[depth]) at--;
  removeConcept(cs, from);
  return insertConcept(cs, target, concept, at);
}

/** A path as a stable string key, for use in UI state */
export function pathKey(path) {
  return path.join('.');
}

export function parsePathKey(key) {
  return key === '' ? [] : key.split('.').map(Number);
}

/** All codes, with their paths */
export function codeIndex(cs) {
  const index = new Map();
  walk(cs, (c, path) => {
    if (c.code === undefined) return;
    const k = cs.caseSensitive === false ? c.code.toLowerCase() : c.code;
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(path);
  });
  return index;
}

/** A code that doesn't exist in the code system yet, of the form prefix-N */
export function uniqueCode(cs, prefix = 'new') {
  const index = codeIndex(cs);
  const norm = s => (cs.caseSensitive === false ? s.toLowerCase() : s);
  for (let n = 1; ; n++) {
    const code = `${prefix}-${n}`;
    if (!index.has(norm(code))) return code;
  }
}

/**
 * Finds concepts whose code, display or definition contains text (case-insensitive).
 * Returns their paths in document order.
 */
export function searchConcepts(cs, text) {
  const t = text.trim().toLowerCase();
  if (!t) return [];
  const hits = [];
  walk(cs, (c, path) => {
    if ((c.code || '').toLowerCase().includes(t) ||
        (c.display || '').toLowerCase().includes(t) ||
        (c.definition || '').toLowerCase().includes(t)) {
      hits.push(path);
    }
  });
  return hits;
}

/**
 * Points code-typed property values (in this code system) that refer to oldCode
 * at newCode instead. Does nothing if some concept still has oldCode, since the
 * references are then still valid. Returns the number of references changed.
 */
export function retargetCodeReferences(cs, oldCode, newCode) {
  if (!oldCode || oldCode === newCode) return 0;
  let stillUsed = false;
  walk(cs, c => { if (c.code === oldCode) stillUsed = true; });
  if (stillUsed) return 0;
  const codeProps = new Set((cs.property || []).filter(isConceptReferenceProperty).map(p => p.code));
  let n = 0;
  walk(cs, c => {
    for (const p of c.property || []) {
      if (codeProps.has(p.code) && p.valueCode === oldCode) {
        p.valueCode = newCode;
        n++;
      }
    }
  });
  return n;
}

/** Renames a code, updating code-typed property values in this code system that point at it. Returns the number of references updated. */
export function renameCode(cs, path, newCode) {
  const concept = getConcept(cs, path);
  const oldCode = concept.code;
  concept.code = newCode;
  return retargetCodeReferences(cs, oldCode, newCode);
}

/** The concept's property entries for a property code */
export function propertyValues(concept, code) {
  return (concept?.property || []).filter(p => p.code === code);
}

/**
 * Sets the value of a property on a concept that has at most one value for it
 * (the concepts grid edits these in place). value undefined removes it.
 * Other elements on the property entry (extensions, id) are kept.
 */
export function setSingleProperty(cs, path, code, type, value) {
  const c = getConcept(cs, path);
  if (!c) return;
  const list = c.property || [];
  const i = list.findIndex(p => p.code === code);
  if (value === undefined) {
    if (i >= 0) list.splice(i, 1);
  } else {
    const entry = i >= 0 ? list[i] : { code };
    for (const k of Object.keys(entry)) if (k.startsWith('value') && /^[A-Z]/.test(k[5] || '')) delete entry[k];
    entry[valueKeyForType(type)] = value;
    if (i < 0) list.push(entry);
  }
  if (list.length) c.property = list; else delete c.property;
}

// --- property definitions ------------------------------------------------

/** How many concept properties use each property code */
export function propertyUsage(cs) {
  const usage = new Map();
  walk(cs, c => {
    for (const p of c.property || []) usage.set(p.code, (usage.get(p.code) || 0) + 1);
  });
  return usage;
}

/**
 * Renames a property definition and every concept property that uses it.
 * If another definition already has oldCode (a duplicate), only the definition
 * at index is renamed, and concept properties are left alone.
 */
export function renamePropertyDefinition(cs, oldCode, newCode, index) {
  const defs = cs.property || [];
  const i = index ?? defs.findIndex(p => p.code === oldCode);
  if (defs[i]) defs[i].code = newCode;
  if (!oldCode || oldCode === newCode || defs.some(p => p.code === oldCode)) return;
  walk(cs, c => {
    for (const p of c.property || []) if (p.code === oldCode) p.code = newCode;
  });
}

/**
 * Changes a property definition's type. Concept property values are converted
 * where that is lossless (e.g. integer -> string); values that can't be
 * converted are left with their old value[x] so that validation reports them.
 */
export function changePropertyType(cs, code, newType) {
  const def = (cs.property || []).find(p => p.code === code);
  if (!def) return;
  def.type = newType;
  const newKey = valueKeyForType(newType);
  walk(cs, c => {
    for (const p of c.property || []) {
      if (p.code !== code) continue;
      const oldKey = valueKeyOf(p);
      if (!oldKey || oldKey === newKey) continue;
      const converted = convertValue(p[oldKey], typeOfValueKey(oldKey), newType);
      if (converted !== undefined) {
        delete p[oldKey];
        p[newKey] = converted;
      }
    }
  });
}

function convertValue(value, from, to) {
  if (from === 'Coding' || to === 'Coding') {
    if (to === 'Coding' && typeof value === 'string') return { code: value };
    if (from === 'Coding' && (to === 'code' || to === 'string') && value?.code) return value.code;
    return undefined;
  }
  const s = String(value);
  switch (to) {
    case 'string': return s;
    case 'code': return /\s/.test(s.trim()) || s.trim() === '' ? undefined : s.trim();
    case 'integer': return /^-?\d+$/.test(s) ? parseInt(s, 10) : undefined;
    case 'decimal': return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : undefined;
    case 'boolean': return s === 'true' ? true : s === 'false' ? false : undefined;
    case 'dateTime': return undefined;
    default: return undefined;
  }
}

/** Parses text typed into a property value field into the JSON value for the type. Returns {value} or {error}. */
export function parsePropertyValue(type, text) {
  switch (type) {
    case 'integer':
      if (!/^-?\d+$/.test(text.trim())) return { error: 'Not a valid integer' };
      return { value: parseInt(text, 10) };
    case 'decimal':
      if (!/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(text.trim())) return { error: 'Not a valid decimal' };
      return { value: Number(text) };
    case 'boolean':
      if (text !== 'true' && text !== 'false') return { error: 'Must be true or false' };
      return { value: text === 'true' };
    default:
      return { value: text };
  }
}

// --- serialisation --------------------------------------------------------

function tidyConcept(c) {
  const out = { ...c };
  if (out.designation) out.designation = out.designation.map(d => orderKeys(d, DESIGNATION_ORDER));
  if (out.property) out.property = out.property.map(p => orderKeys(p, CONCEPT_PROPERTY_ORDER));
  if (out.concept) out.concept = out.concept.map(tidyConcept);
  return orderKeys(out, CONCEPT_ORDER);
}

/**
 * The resource as it should be saved: empty elements removed, elements in
 * specification order. Does not change the input.
 */
export function normalize(cs) {
  const copy = prune(structuredClone(cs)) || { resourceType: 'CodeSystem' };
  if (copy.property) copy.property = copy.property.map(p => orderKeys(p, PROPERTY_ORDER));
  if (copy.filter) copy.filter = copy.filter.map(f => orderKeys(f, FILTER_ORDER));
  if (copy.concept) copy.concept = copy.concept.map(tidyConcept);
  return orderKeys(copy, CODESYSTEM_ORDER);
}
