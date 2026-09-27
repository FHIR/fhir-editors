// Hosts for editing a local file from a web page.
//
//   createFileHandleHost(handle)  - a FileSystemFileHandle (File System Access API:
//       Chromium browsers, including Electron). Saves write back to the file itself.
//   createDownloadHost(file)      - a plain File (from <input type=file> or a drop),
//       for browsers without that API. Saves download a new copy of the file.
//
// openLocalFile() shows the best picker the browser has and returns the right host.

import { createTerminologyLookup } from './host.js';

export const canWriteFiles = typeof globalThis.showOpenFilePicker === 'function';

const JSON_TYPES = [{ description: 'FHIR JSON', accept: { 'application/json': ['.json'], 'application/fhir+json': ['.json'] } }];

function serialize(resource) {
  return JSON.stringify(resource, null, 2) + '\n';
}

function parse(text, name) {
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (e) {
    throw new Error(`${name} is not valid JSON: ${e.message}`);
  }
}

function addLookup(host, terminologyServer, lookup) {
  if (lookup) host.lookup = lookup;
  else if (terminologyServer) host.lookup = createTerminologyLookup(terminologyServer);
  return host;
}

/**
 * @param {FileSystemFileHandle} handle
 * @param {Object} [options]
 * @param {string} [options.terminologyServer]  base URL for lookup()
 * @param {Function} [options.lookup]            or a lookup function
 */
export function createFileHandleHost(handle, { terminologyServer, lookup } = {}) {
  const host = {
    label: handle.name,
    readOnly: false,
    handle,
    async load() {
      const file = await handle.getFile();
      return parse(await file.text(), handle.name);
    },
    async save(resource) {
      // Permission may have lapsed (e.g. a handle restored from a previous session)
      if (handle.queryPermission && (await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
        if (!handle.requestPermission || (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') {
          throw new Error(`Permission to write ${handle.name} was not granted`);
        }
      }
      const w = await handle.createWritable();
      try {
        await w.write(serialize(resource));
        await w.close();
      } catch (e) {
        await w.abort?.();
        throw e;
      }
    }
  };
  return addLookup(host, terminologyServer, lookup);
}

/**
 * @param {File} file
 * @param {Object} [options]  as for createFileHandleHost
 */
export function createDownloadHost(file, { terminologyServer, lookup } = {}) {
  const host = {
    label: `${file.name} (saving downloads a copy)`,
    readOnly: false,
    async load() {
      return parse(await file.text(), file.name);
    },
    async save(resource) {
      const url = URL.createObjectURL(new Blob([serialize(resource)], { type: 'application/fhir+json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  };
  return addLookup(host, terminologyServer, lookup);
}

/**
 * Asks the user for a JSON file. Returns a host for it, or null if they cancelled.
 * Uses the File System Access API where available (so saves go back to the file),
 * otherwise an <input type=file>.
 */
export async function openLocalFile(options = {}) {
  if (canWriteFiles) {
    try {
      const [handle] = await globalThis.showOpenFilePicker({ types: JSON_TYPES, multiple: false });
      return createFileHandleHost(handle, options);
    } catch (e) {
      if (e.name === 'AbortError') return null;
      throw e;
    }
  }
  const file = await new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json,application/fhir+json';
    input.addEventListener('change', () => resolve(input.files[0] || null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
  return file ? createDownloadHost(file, options) : null;
}

/**
 * A host for a file dropped on the page (a DataTransferItem). Uses a writable
 * handle where the browser provides one.
 */
export async function hostFromDrop(item, options = {}) {
  if (item.getAsFileSystemHandle) {
    const h = await item.getAsFileSystemHandle();
    if (h?.kind === 'file') return createFileHandleHost(h, options);
  }
  const file = item.getAsFile();
  return file ? createDownloadHost(file, options) : null;
}
