// The editor's own checks on a CodeSystem. These are the things an author can
// fix in the editor; they are not a substitute for the FHIR validator (a host
// can add that through host.validate).
//
// Each issue: { severity: 'error'|'warning'|'information', location, message,
//               conceptPath?, section? }
// location is a FHIRPath-style path (CodeSystem.concept[0].concept[3].code).
// conceptPath lets the editor jump to the concept; section names the tab.

import { PATTERNS, isAbsoluteUri } from '../core/fhir-json.js';
import {
  walk, countConcepts, isConceptReferenceProperty, valueKeyOf, typeOfValueKey, valueKeyForType,
  STATUS_CODES, CONTENT_CODES, HIERARCHY_CODES, PROPERTY_TYPES, FILTER_OPERATORS
} from './model.js';

const NAME_PATTERN = /^[A-Z]([A-Za-z0-9_]){1,254}$/;

// Properties defined by the FHIR specification, with the type they must have
// (http://hl7.org/fhir/concept-properties)
const STANDARD_PROPERTIES = {
  'http://hl7.org/fhir/concept-properties#status': 'code',
  'http://hl7.org/fhir/concept-properties#inactive': 'boolean',
  'http://hl7.org/fhir/concept-properties#effectiveDate': 'dateTime',
  'http://hl7.org/fhir/concept-properties#deprecated': 'dateTime',
  'http://hl7.org/fhir/concept-properties#retirementDate': 'dateTime',
  'http://hl7.org/fhir/concept-properties#notSelectable': 'boolean',
  'http://hl7.org/fhir/concept-properties#parent': 'code',
  'http://hl7.org/fhir/concept-properties#child': 'code',
  'http://hl7.org/fhir/concept-properties#partOf': 'code',
  'http://hl7.org/fhir/concept-properties#synonym': 'code',
  'http://hl7.org/fhir/concept-properties#comment': 'string',
  'http://hl7.org/fhir/concept-properties#itemWeight': 'decimal'
};

export function validateCodeSystem(cs) {
  const issues = [];
  const add = (severity, location, message, extra = {}) =>
    issues.push({ severity, location, message, ...extra });

  if (cs.resourceType !== 'CodeSystem') {
    add('error', 'resourceType', `resourceType must be CodeSystem, not ${cs.resourceType}`, { section: 'json' });
    return issues;
  }

  // --- metadata
  const meta = { section: 'metadata' };
  if (cs.id !== undefined && !PATTERNS.id.test(cs.id)) {
    add('error', 'CodeSystem.id', `The id "${cs.id}" is not valid (letters, digits, '-' and '.', max 64)`, meta);
  }
  if (!cs.url) {
    add('warning', 'CodeSystem.url', 'A code system should have a canonical URL', meta);
  } else if (!isAbsoluteUri(cs.url) || /\s/.test(cs.url)) {
    add('error', 'CodeSystem.url', `The URL "${cs.url}" is not an absolute URI`, meta);
  } else if (/[|#]/.test(cs.url)) {
    add('error', 'CodeSystem.url', 'A canonical URL cannot contain | or #', meta);
  }
  if (!cs.name) {
    add('warning', 'CodeSystem.name', 'A code system should have a name', meta);
  } else if (!NAME_PATTERN.test(cs.name)) {
    add('warning', 'CodeSystem.name', `The name "${cs.name}" should be computer friendly (start with a capital letter; letters, digits and _ only)`, meta);
  }
  if (!cs.status) {
    add('error', 'CodeSystem.status', 'status is required', meta);
  } else if (!STATUS_CODES.includes(cs.status)) {
    add('error', 'CodeSystem.status', `Unknown status "${cs.status}"`, meta);
  }
  if (cs.date !== undefined && !PATTERNS.dateTime.test(cs.date)) {
    add('error', 'CodeSystem.date', `"${cs.date}" is not a valid dateTime`, meta);
  }
  if (cs.hierarchyMeaning !== undefined && !HIERARCHY_CODES.includes(cs.hierarchyMeaning)) {
    add('error', 'CodeSystem.hierarchyMeaning', `Unknown hierarchyMeaning "${cs.hierarchyMeaning}"`, meta);
  }

  // --- content
  const n = countConcepts(cs);
  if (!cs.content) {
    add('error', 'CodeSystem.content', 'content is required', meta);
  } else if (!CONTENT_CODES.includes(cs.content)) {
    add('error', 'CodeSystem.content', `Unknown content "${cs.content}"`, meta);
  } else {
    if (cs.content === 'supplement' && !cs.supplements) {
      add('error', 'CodeSystem.supplements', 'A supplement must say which code system it supplements', meta);
    }
    if (cs.supplements && cs.content !== 'supplement') {
      add('error', 'CodeSystem.content', 'content must be "supplement" when supplements is present', meta);
    }
    if (cs.content === 'not-present' && n > 0) {
      add('warning', 'CodeSystem.content', `content is "not-present" but the code system has ${n} concept(s)`, meta);
    }
    if (cs.content === 'complete' && n === 0) {
      add('warning', 'CodeSystem.concept', 'content is "complete" but there are no concepts', { section: 'concepts' });
    }
    if (cs.content === 'complete' && cs.count !== undefined && cs.count !== n) {
      add('warning', 'CodeSystem.count', `count is ${cs.count} but there are ${n} concepts`, meta);
    }
  }

  // --- property definitions
  const defs = new Map();
  (cs.property || []).forEach((p, i) => {
    const loc = `CodeSystem.property[${i}]`;
    const sec = { section: 'properties' };
    if (!p.code) {
      add('error', `${loc}.code`, `Property #${i + 1} has no code`, sec);
    } else if (defs.has(p.code)) {
      add('error', `${loc}.code`, `The property code "${p.code}" is defined more than once`, sec);
    } else {
      defs.set(p.code, p);
    }
    if (!p.type) {
      add('error', `${loc}.type`, `Property "${p.code || i + 1}" has no type`, sec);
    } else if (!PROPERTY_TYPES.includes(p.type)) {
      add('error', `${loc}.type`, `Property "${p.code}" has an unknown type "${p.type}"`, sec);
    }
    if (p.uri) {
      if (!isAbsoluteUri(p.uri)) add('error', `${loc}.uri`, `The URI "${p.uri}" is not absolute`, sec);
      const std = STANDARD_PROPERTIES[p.uri];
      if (std && p.type && p.type !== std) {
        add('warning', `${loc}.type`, `${p.uri} is defined with type ${std}, not ${p.type}`, sec);
      }
    }
  });

  // --- filters
  (cs.filter || []).forEach((f, i) => {
    const loc = `CodeSystem.filter[${i}]`;
    const sec = { section: 'filters' };
    if (!f.code) add('error', `${loc}.code`, `Filter #${i + 1} has no code`, sec);
    if (!f.operator || f.operator.length === 0) {
      add('error', `${loc}.operator`, `Filter "${f.code || i + 1}" has no operators`, sec);
    } else {
      for (const op of f.operator) {
        if (!FILTER_OPERATORS.includes(op)) add('error', `${loc}.operator`, `Filter "${f.code}" has an unknown operator "${op}"`, sec);
      }
    }
    if (!f.value) add('error', `${loc}.value`, `Filter "${f.code || i + 1}" has no value description`, sec);
  });

  // --- concepts
  const seen = new Map();
  const norm = s => (cs.caseSensitive === false ? s.toLowerCase() : s);
  walk(cs, c => {
    if (c.code) {
      const k = norm(c.code);
      seen.set(k, (seen.get(k) || 0) + 1);
    }
  });
  const codeRefs = [];
  walk(cs, (c, path) => {
    const loc = 'CodeSystem' + path.map(i => `.concept[${i}]`).join('');
    const where = { section: 'concepts', conceptPath: path };
    const label = c.code ? `"${c.code}"` : `at ${loc}`;
    if (!c.code) {
      add('error', `${loc}.code`, 'A concept has no code', where);
    } else {
      if (!PATTERNS.code.test(c.code)) {
        add('error', `${loc}.code`, `The code "${c.code}" has leading, trailing or repeated whitespace`, where);
      }
      if (seen.get(norm(c.code)) > 1) {
        add('error', `${loc}.code`, cs.caseSensitive === false
          ? `The code "${c.code}" is used more than once (ignoring case, as the code system is not case sensitive)`
          : `The code "${c.code}" is used more than once`, where);
      }
    }
    if (!c.display && cs.content !== 'supplement') {
      add('information', `${loc}.display`, `Concept ${label} has no display`, where);
    }
    (c.designation || []).forEach((d, j) => {
      const dl = `${loc}.designation[${j}]`;
      if (!d.value) add('error', `${dl}.value`, `A designation on concept ${label} has no value`, where);
      if (d.language && !PATTERNS.language.test(d.language)) {
        add('warning', `${dl}.language`, `"${d.language}" does not look like a valid language code`, where);
      }
      if (d.use && !d.use.code && !d.use.display) {
        add('warning', `${dl}.use`, `A designation on concept ${label} has a use with no code`, where);
      }
    });
    (c.property || []).forEach((p, j) => {
      const pl = `${loc}.property[${j}]`;
      if (!p.code) {
        add('error', `${pl}.code`, `A property on concept ${label} has no code`, where);
        return;
      }
      const def = defs.get(p.code);
      const key = valueKeyOf(p);
      if (!key) {
        add('error', `${pl}.value`, `Property "${p.code}" on concept ${label} has no value`, where);
        return;
      }
      if (!def) {
        add('error', `${pl}.code`, `Property "${p.code}" on concept ${label} is not defined in CodeSystem.property`, where);
        return;
      }
      if (def.type && key !== valueKeyForType(def.type)) {
        add('error', `${pl}.value`, `Property "${p.code}" on concept ${label} is a ${typeOfValueKey(key)}, but is defined as ${def.type}`, where);
        return;
      }
      if (def.type === 'dateTime' && !PATTERNS.dateTime.test(p.valueDateTime)) {
        add('error', `${pl}.value`, `"${p.valueDateTime}" is not a valid dateTime`, where);
      }
      if (isConceptReferenceProperty(def)) codeRefs.push({ value: p.valueCode, loc: pl, where, prop: p.code, label });
    });
  });

  // concept-reference properties refer to codes in this code system
  if (cs.content === 'complete') {
    for (const r of codeRefs) {
      if (r.value && !seen.has(norm(r.value))) {
        add('warning', `${r.loc}.value`, `Property "${r.prop}" on concept ${r.label} refers to "${r.value}", which is not a code in this code system`, r.where);
      }
    }
  }

  return issues;
}

/** Issues sorted most severe first, then document order */
export function sortIssues(issues) {
  const rank = { error: 0, warning: 1, information: 2 };
  return [...issues].sort((a, b) => rank[a.severity] - rank[b.severity]);
}
