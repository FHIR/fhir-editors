// Main-process side of the Electron host. Call once at startup:
//
//   const { registerEditorHandlers } = require('fhir-editors/electron/main');
//   const editors = registerEditorHandlers(ipcMain, { roots: () => listOfIgFolders() });
//
// The renderer can only read and write through these handlers, and only:
//   - .json files
//   - inside one of the roots (when roots is given)
//   - for writes, files it has already read (so a compromised renderer can't
//     create or overwrite arbitrary files)
//
// Writes are atomic (temp file + rename), so a crash can't leave half a resource.
//
// editors.allow(file) lets the app permit a write to a file that hasn't been read
// (e.g. one the app has just created from a template).

const fs = require('fs');
const path = require('path');

const CHANNELS = {
  read: 'fhir-editors:read',
  write: 'fhir-editors:write'
};

function registerEditorHandlers(ipcMain, { roots } = {}) {
  const readable = new Set();

  const check = file => {
    if (typeof file !== 'string' || !path.isAbsolute(file)) {
      throw new Error('A resource file must be given as an absolute path');
    }
    const resolved = path.resolve(file);
    if (path.extname(resolved).toLowerCase() !== '.json') {
      throw new Error(`Only .json files can be edited (${resolved})`);
    }
    const list = typeof roots === 'function' ? roots() : roots;
    if (list && list.length) {
      const inside = list.some(root => {
        const rel = path.relative(path.resolve(root), resolved);
        return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
      });
      if (!inside) throw new Error(`${resolved} is not in a folder this application manages`);
    }
    return resolved;
  };

  ipcMain.handle(CHANNELS.read, async (event, file) => {
    const f = check(file);
    const text = await fs.promises.readFile(f, 'utf8');
    readable.add(f);
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  });

  ipcMain.handle(CHANNELS.write, async (event, file, text) => {
    const f = check(file);
    if (!readable.has(f)) throw new Error(`${f} has not been opened for editing`);
    if (typeof text !== 'string') throw new Error('Nothing to write');
    JSON.parse(text); // never write something that isn't JSON
    const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(tmp, text, 'utf8');
    try {
      await fs.promises.rename(tmp, f);
    } catch (e) {
      await fs.promises.rm(tmp, { force: true });
      throw e;
    }
  });

  return {
    allow(file) { readable.add(check(file)); },
    dispose() {
      ipcMain.removeHandler(CHANNELS.read);
      ipcMain.removeHandler(CHANNELS.write);
    }
  };
}

module.exports = { registerEditorHandlers, CHANNELS };
