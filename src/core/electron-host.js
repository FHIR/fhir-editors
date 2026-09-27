// The renderer side of the Electron host. Talks to the handlers registered by
// hosts/electron/main.cjs, over whichever IPC channel the app provides:
//
//   - apps with contextIsolation (recommended): load hosts/electron/preload.cjs,
//     which exposes window.fhirEditors; createElectronHost() finds it.
//   - apps with nodeIntegration (like the IG Publisher Manager today): pass
//     require('electron').ipcRenderer as options.ipc.
//
// options:
//   file        path of the resource file to edit (required)
//   ipc         something with invoke(channel, ...args); defaults to window.fhirEditors
//   readOnly    open read-only
//   terminologyServer  base URL for lookup(), e.g. 'https://tx.fhir.org/r4'

import { createTerminologyLookup } from './host.js';

export const CHANNELS = {
  read: 'fhir-editors:read',
  write: 'fhir-editors:write'
};

export function createElectronHost({ file, ipc, readOnly = false, terminologyServer } = {}) {
  if (!file) throw new Error('createElectronHost: file is required');
  const channel = ipc || globalThis.fhirEditors;
  if (!channel || typeof channel.invoke !== 'function') {
    throw new Error('createElectronHost: no IPC channel. Load fhir-editors/electron/preload in the BrowserWindow, or pass options.ipc');
  }
  const host = {
    label: file,
    readOnly,
    async load() {
      const text = await channel.invoke(CHANNELS.read, file);
      return JSON.parse(text);
    },
    async save(resource) {
      await channel.invoke(CHANNELS.write, file, JSON.stringify(resource, null, 2) + '\n');
    }
  };
  if (terminologyServer) host.lookup = createTerminologyLookup(terminologyServer);
  return host;
}
