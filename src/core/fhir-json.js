// Helpers for working with FHIR resources as plain JSON. The editors use the
// resource JSON itself as their model, so anything they don't know about
// (extensions, elements from a later version, etc.) passes through untouched.

/**
 * Returns a copy of obj with keys in the given order. Keys not in the order
 * list keep their relative order and go at the end. A primitive's "_x"
 * companion element is kept immediately after "x".
 */
export function orderKeys(obj, order) {
  const result = {};
  const rank = new Map(order.map((k, i) => [k, i]));
  const keys = Object.keys(obj);
  const baseName = k => (k.startsWith('_') ? k.slice(1) : k);
  const choiceBase = k => {
    // valueCode -> value[x] is listed as 'value'. Exact names win (copyrightLabel is
    // not copyright[x]), then the longest matching prefix (versionAlgorithmString is
    // versionAlgorithm[x], not version).
    if (rank.has(k)) return k;
    let best = k;
    for (const o of order) {
      if (k.startsWith(o) && /^[A-Z]/.test(k.slice(o.length)) && (best === k || o.length > best.length)) best = o;
    }
    return best;
  };
  const sortKey = k => {
    const b = choiceBase(baseName(k));
    return rank.has(b) ? rank.get(b) : order.length + keys.indexOf(k);
  };
  const sorted = [...keys].sort((a, b) => {
    const d = sortKey(a) - sortKey(b);
    if (d !== 0) return d;
    // same element: "x" before "_x"
    return (a.startsWith('_') ? 1 : 0) - (b.startsWith('_') ? 1 : 0);
  });
  for (const k of sorted) result[k] = obj[k];
  return result;
}

/**
 * Removes empty strings, null/undefined, empty arrays and empty objects,
 * recursively. FHIR JSON does not allow any of these.
 * Returns undefined if the whole value is empty.
 */
export function prune(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value === '' ? undefined : value;
  if (Array.isArray(value)) {
    const items = value.map(prune).filter(v => v !== undefined);
    return items.length ? items : undefined;
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const p = prune(v);
      if (p !== undefined) out[k] = p;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value;
}

/** Sets obj[key] = value, or deletes the key if the value is empty. */
export function setOrDelete(obj, key, value) {
  if (value === undefined || value === null || value === '' ||
      (Array.isArray(value) && value.length === 0)) {
    delete obj[key];
  } else {
    obj[key] = value;
  }
}

/** Pretty JSON the way the FHIR tooling writes it (2 space indent). */
export function toJson(resource) {
  return JSON.stringify(resource, null, 2);
}

// FHIR primitive formats, from the specification
export const PATTERNS = {
  code: /^[^\s]+( [^\s]+)*$/,
  uri: /^\S*$/,
  id: /^[A-Za-z0-9\-.]{1,64}$/,
  dateTime: /^([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)(-(0[1-9]|1[0-2])(-(0[1-9]|[1-2][0-9]|3[0-1])(T([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\.[0-9]{1,9})?)?)?(Z|(\+|-)((0[0-9]|1[0-3]):[0-5][0-9]|14:00)?)?)?$/,
  integer: /^(0|[-+]?[1-9][0-9]*)$/,
  decimal: /^-?(0|[1-9][0-9]{0,17})(\.[0-9]{1,17})?([eE][+-]?[0-9]{1,9})?$/,
  // a rough check - full BCP 47 validation belongs to the terminology server
  language: /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{1,8})*$/
};

export function isAbsoluteUri(s) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s);
}
