// Preload script for BrowserWindows that use contextIsolation (recommended):
//
//   new BrowserWindow({ webPreferences: {
//     preload: require.resolve('fhir-editors/electron/preload'),
//     contextIsolation: true, nodeIntegration: false
//   }});
//
// Exposes window.fhirEditors.invoke(channel, ...args), limited to the editor
// channels. createElectronHost() uses it automatically.
//
// If your app already has its own preload, require this file from it instead.

const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED = new Set(['fhir-editors:read', 'fhir-editors:write']);

contextBridge.exposeInMainWorld('fhirEditors', {
  invoke(channel, ...args) {
    if (!ALLOWED.has(channel)) return Promise.reject(new Error(`Channel ${channel} is not allowed`));
    return ipcRenderer.invoke(channel, ...args);
  }
});
