// The host adapter: everything an editor needs from the environment it runs in.
//
// Editors never touch Node, Electron or a particular server. They are given a host
// object and call only these methods. Each environment supplies its own:
//
//   - MemoryHost        in-page, for the demo and for tests
//   - createFetchHost   a web page served by FHIRsmith (or any server)
//   - createElectronHost  an Electron renderer (see hosts/electron)
//
// Methods other than load/save are optional; editors check for them before use.

/**
 * @typedef {Object} EditorHost
 * @property {() => Promise<object>} load
 *     Returns the resource to edit.
 * @property {(resource: object) => Promise<void|object>} save
 *     Persists the resource. May return the stored version (e.g. with a new
 *     meta.versionId), which the editor then adopts.
 * @property {boolean} [readOnly]
 *     If true, the editor shows the resource but does not allow changes.
 * @property {string} [label]
 *     A short description of where the resource lives (a file path, a URL),
 *     shown in the editor toolbar.
 * @property {(system: string, code: string, version?: string) =>
 *     Promise<{display?: string, found: boolean, message?: string}>} [lookup]
 *     Terminology lookup, used to check codings entered in the editor
 *     (designation.use, etc).
 * @property {(resource: object) => Promise<Array<{severity: string, location?: string, message: string}>>} [validate]
 *     Additional validation beyond the editor's own checks.
 */

/**
 * A host that holds the resource in memory. save() records a copy, which is
 * available as host.saved; onSave (if given) is called with each saved copy.
 */
export class MemoryHost {
  constructor(resource, { readOnly = false, label = 'in memory', onSave, lookup, validate } = {}) {
    this.resource = structuredClone(resource);
    this.readOnly = readOnly;
    this.label = label;
    this.saved = null;
    this.saveCount = 0;
    this._onSave = onSave;
    if (lookup) this.lookup = lookup;
    if (validate) this.validate = validate;
  }

  async load() {
    return structuredClone(this.resource);
  }

  async save(resource) {
    this.resource = structuredClone(resource);
    this.saved = structuredClone(resource);
    this.saveCount++;
    if (this._onSave) this._onSave(this.saved);
  }
}

/**
 * A host that loads and saves over HTTP. Suits a page served by FHIRsmith, or any
 * FHIR server (loadUrl = saveUrl = [base]/CodeSystem/[id]).
 *
 * @param {Object} options
 * @param {string} options.loadUrl   GET returns the resource as JSON
 * @param {string} [options.saveUrl] PUT receives the resource as JSON; omit for read-only
 * @param {Object} [options.headers] extra headers (e.g. a CSRF token)
 * @param {string} [options.credentials='same-origin']
 * @param {string} [options.terminologyServer] base URL of a FHIR terminology server,
 *     used for lookup(). Relative URLs are fine (e.g. '/r4').
 */
export function createFetchHost({ loadUrl, saveUrl, headers = {}, credentials = 'same-origin', terminologyServer, label } = {}) {
  if (!loadUrl) throw new Error('createFetchHost: loadUrl is required');
  const jsonHeaders = { 'Accept': 'application/fhir+json, application/json', ...headers };
  const host = {
    label: label || loadUrl,
    readOnly: !saveUrl,
    async load() {
      const res = await fetch(loadUrl, { headers: jsonHeaders, credentials });
      if (!res.ok) throw new Error(`Unable to load ${loadUrl}: ${res.status} ${await errorText(res)}`);
      return res.json();
    },
    async save(resource) {
      if (!saveUrl) throw new Error('This host is read-only');
      const res = await fetch(saveUrl, {
        method: 'PUT',
        headers: { ...jsonHeaders, 'Content-Type': 'application/fhir+json' },
        credentials,
        body: JSON.stringify(resource)
      });
      if (!res.ok) throw new Error(`Unable to save to ${saveUrl}: ${res.status} ${await errorText(res)}`);
      const text = await res.text();
      if (!text) return undefined;
      try {
        const stored = JSON.parse(text);
        return stored && stored.resourceType === resource.resourceType ? stored : undefined;
      } catch {
        return undefined;
      }
    }
  };
  if (terminologyServer) {
    host.lookup = createTerminologyLookup(terminologyServer, { credentials });
  }
  return host;
}

/**
 * Builds a lookup() function that calls CodeSystem/$lookup on a FHIR terminology
 * server. Results are cached for the life of the function.
 */
export function createTerminologyLookup(baseUrl, { credentials = 'omit', fetchImpl } = {}) {
  const base = baseUrl.replace(/\/+$/, '');
  const cache = new Map();
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  return async function lookup(system, code, version) {
    const key = `${system}|${version || ''}|${code}`;
    if (cache.has(key)) return cache.get(key);
    const params = new URLSearchParams({ system, code });
    if (version) params.set('version', version);
    const promise = (async () => {
      try {
        const res = await doFetch(`${base}/CodeSystem/$lookup?${params}`, {
          headers: { 'Accept': 'application/fhir+json' },
          credentials
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          return { found: false, message: operationOutcomeText(body) || `${res.status} ${res.statusText}` };
        }
        const display = (body?.parameter || []).find(p => p.name === 'display')?.valueString;
        return { found: true, display };
      } catch (e) {
        // A network failure is not "code not found" - don't cache it
        cache.delete(key);
        return { found: false, message: `Unable to reach ${base}: ${e.message}`, unreachable: true };
      }
    })();
    cache.set(key, promise);
    return promise;
  };
}

async function errorText(res) {
  const text = await res.text().catch(() => '');
  try {
    return operationOutcomeText(JSON.parse(text)) || text.slice(0, 200);
  } catch {
    return text.slice(0, 200);
  }
}

function operationOutcomeText(body) {
  if (body?.resourceType !== 'OperationOutcome') return undefined;
  return (body.issue || [])
    .map(i => i.details?.text || i.diagnostics)
    .filter(Boolean)
    .join('; ');
}
