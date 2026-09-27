// Minimal Electron host for the CodeSystem editor.
//
//   cd examples/electron && npm install && npm start [path/to/CodeSystem.json]
//
// With no file on the command line, a file dialog is shown.
// Uses contextIsolation + the package's preload, which is the recommended setup.
// (Apps with nodeIntegration, like the IG Publisher Manager, can instead pass
// require('electron').ipcRenderer to createElectronHost - see the README.)

const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const { registerEditorHandlers } = require('../../hosts/electron/main.cjs');

let folder = null;

app.whenReady().then(async () => {
  let file = process.argv.slice(app.isPackaged ? 1 : 2).find(a => a.endsWith('.json'));
  if (!file) {
    const r = await dialog.showOpenDialog({ filters: [{ name: 'FHIR JSON', extensions: ['json'] }], properties: ['openFile'] });
    if (r.canceled) return app.quit();
    file = r.filePaths[0];
  }
  file = path.resolve(file);
  folder = path.dirname(file);

  // Only files in the folder we opened can be read or written
  registerEditorHandlers(ipcMain, { roots: () => [folder] });

  const win = new BrowserWindow({
    width: 1300,
    height: 900,
    title: `CodeSystem - ${path.basename(file)}`,
    webPreferences: {
      preload: path.join(__dirname, '../../hosts/electron/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  // renderer.js blocks unload while there are unsaved changes; ask the user
  win.webContents.on('will-prevent-unload', e => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Discard changes', 'Keep editing'],
      defaultId: 1,
      cancelId: 1,
      message: 'This code system has unsaved changes.'
    });
    if (choice === 0) e.preventDefault(); // i.e. let the window close
  });

  await win.loadFile(path.join(__dirname, 'index.html'), { query: { file } });
});

app.on('window-all-closed', () => app.quit());
