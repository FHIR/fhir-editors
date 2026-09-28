# fhir-editors

Browser-based editors for FHIR resources. The same code runs in an Electron app and in a web page served by FHIRsmith.

For now there is one editor, `<cs-editor>`, for CodeSystem.

## How it works

The editors are [Lit](https://lit.dev) web components. They only use standard
browser APIs, and never touch Node, Electron or a particular server. Everything
that depends on where they run goes through a **host** object that the page
provides:

```js
editor.host = {
  load(),               // -> the resource (JSON)
  save(resource),       // persist it; may return the stored version
  readOnly,             // optional
  label,                // optional: where the resource lives (shown in the toolbar)
  lookup(system, code), // optional: terminology lookup, used to check codings
  validate(resource)    // optional: extra validation, e.g. by a server
};
```

Three hosts are provided:

| Host | For |
|---|---|
| `createFetchHost({ loadUrl, saveUrl, terminologyServer })` | Web pages, for a web application. GET to load, PUT to save. |
| `createElectronHost({ file, ipc?, terminologyServer })` | Electron renderers. Reads and writes the file through the main process. |
| `createFileHandleHost(handle)` | A local file in a browser with the File System Access API (Chromium, Electron). Saves write the file itself. |
| `createDownloadHost(file)` | A local file in other browsers. Saves download a copy. |
| `new MemoryHost(resource, { onSave })` | Demos, tests, and apps that manage storage themselves. |

`openLocalFile()` shows a file picker and returns whichever of the two file
hosts the browser supports (or null if cancelled); `hostFromDrop(item)` does the
same for a dropped file.

Setting `editor.host = null` closes the resource (check `editor.hasChanges`
first).

`createTerminologyLookup(baseUrl)` makes a `lookup()` that calls
`CodeSystem/$lookup` on any FHIR terminology server.

The editor works on the resource JSON directly, so anything it doesn't have a
form for (extensions, contact, useContext, elements from later FHIR versions)
is kept as it is, and can be edited in the JSON tab. On save, empty elements
are removed and elements are put in specification order.

## Layout

```
src/
  core/                 shared by all editors
    host.js             MemoryHost, createFetchHost, createTerminologyLookup
    file-host.js        local files: createFileHandleHost, createDownloadHost, openLocalFile
    electron-host.js    createElectronHost (renderer side)
    editor-base.js      load/save, undo/redo, change tracking, validation, shortcuts
    fhir-json.js        prune, element ordering, FHIR primitive patterns
    styles.js           theme variables and control styles
    widgets/            <fe-coding-input>, <fe-issue-list>
  codesystem/
    cs-editor.js        <cs-editor>
    cs-metadata.js      Metadata tab
    cs-concepts.js      Concepts tab: the concepts grid
    cs-concept-detail.js  everything about one concept (shown in a dialog)
    cs-properties.js    Properties and Filters tabs
    model.js            concept tree operations etc. - plain JS, no DOM
    validation.js       the editor's own checks
hosts/
  electron/main.cjs     main-process IPC handlers
  electron/preload.cjs  preload script for contextIsolation windows
  fhirsmith/router.cjs  Express router that serves dist/
dist/                   built bundles (npm run build) - what hosts load
demo/                   demo page with a MemoryHost
examples/electron/      minimal Electron app
test/                   node --test
```

`npm run build` bundles each editor (with Lit) into `dist/` as ES modules, so
neither host needs a bundler or an import map. Code shared between editors
goes into `dist/chunks/`.

## Using it in Electron

Register the IPC handlers in the main process:

```js
const { registerEditorHandlers } = require('fhir-editors/electron/main');
registerEditorHandlers(ipcMain, { roots: () => foldersTheAppManages });
```

The handlers only read and write `.json` files inside `roots`, only write
files that have already been read, and write atomically (temp file + rename).

**With contextIsolation** (recommended), load the package's preload script in
the window:

```js
new BrowserWindow({ webPreferences: {
  preload: require.resolve('fhir-editors/electron/preload'),
  contextIsolation: true, nodeIntegration: false
}});
```

and in the page:

```html
<cs-editor id="ed" style="display:block; height:100vh"></cs-editor>
<script type="module">
  import { createElectronHost } from './node_modules/fhir-editors/dist/codesystem.js';
  document.getElementById('ed').host = createElectronHost({
    file: '/path/to/input/resources/CodeSystem-x.json',
    terminologyServer: 'https://tx.fhir.org/r4'
  });
</script>
```

**With nodeIntegration** (how the IG Publisher Manager is set up today), skip
the preload and pass the IPC renderer directly:

```js
createElectronHost({ file, ipc: require('electron').ipcRenderer });
```

`examples/electron` is a complete, minimal app:
`cd examples/electron && npm install && npm start path/to/CodeSystem.json`.

Warn about unsaved changes with `editor.hasChanges` (the example does this
with `beforeunload` and `will-prevent-unload`).

## Using it in a Web Application

Serve the bundles:

```js
const { createEditorsRouter } = require('fhir-editors/fhirsmith');
app.use('/editors', createEditorsRouter(express));
```

and in a page:

```html
<cs-editor id="ed" style="display:block; height:80vh"></cs-editor>
<script type="module">
  import { createFetchHost } from '/editors/codesystem.js';
  document.getElementById('ed').host = createFetchHost({
    loadUrl: '/some/CodeSystem/x',
    saveUrl: '/some/CodeSystem/x',     // omit for read-only
    headers: { 'X-CSRF-Token': token }, // whatever the endpoint needs
    terminologyServer: '/r4'
  });
</script>
```

The router only serves static files. Loading, saving and authorisation belong
to the endpoints that `loadUrl` and `saveUrl` point at.

## Editor API

Properties and methods (common to all editors, from `EditorBase`):

- `host`: setting it loads the resource
- `load()`: reload from the host, discarding changes
- `save()`: save through the host (Ctrl/Cmd+S)
- `getResource()`: the resource as it would be saved
- `hasChanges`
- `undo()` / `redo()` (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z outside text fields)
- `issues`: current validation issues
- attributes: `readonly`, `fhir-version` (`4.0.1` default; `5.0.0` shows
  R5-only elements), `theme` (`light` / `dark`; default follows the OS)

Events (bubbling, composed): `fe-loaded`, `fe-change` `{dirty}`,
`fe-saved` `{resource}`, `fe-error` `{error, message}`.

## Theming

Set `--fe-*` custom properties on the editor or any ancestor: `--fe-bg`,
`--fe-surface`, `--fe-fg`, `--fe-muted`, `--fe-border`, `--fe-accent`,
`--fe-accent-fg`, `--fe-select`, `--fe-error`, `--fe-warning`, `--fe-info`,
`--fe-font`, `--fe-mono`, `--fe-radius`.

## The CodeSystem editor

- **Metadata**: identity, status, description, and the content elements
  (content, caseSensitive, hierarchyMeaning, count...). Other elements are
  listed and preserved.
- **Filters**
- **Properties**: property definitions, including the standard
  `concept-properties` ones. Changing a type converts the existing values where
  that can be done without loss.
- **Concepts**: a spreadsheet. One row per concept in hierarchy order (the
  code column is indented, with a twisty to collapse), and columns for code,
  display, definition and each defined property. Cells are edited in place,
  with inputs that follow the property's type. Properties with several values,
  or Coding values, show read-only in the grid. Double-click a code (or Alt+Enter,
  or Details…) to open the concept in a dialog, with designations, every
  property value and children. The toolbar adds, deletes, moves,
  indents/outdents, expands/collapses and searches, and rows can be dragged by
  their ⋮⋮ handle. Renaming a code updates properties that refer to it
  (parent, child, etc.).

  Drag the right edge of a column header to resize it (double-click the edge
  to reset). Widths are remembered in the browser's local storage.

  Keys: ↑/↓ and Enter move between rows in the same column; Ctrl/⌘+Enter
  adds a concept after the current one (with Shift, a child); Alt+↑/↓ moves
  it; Ctrl/⌘+] and Ctrl/⌘+[ indent and outdent; Ctrl/⌘+Shift+Delete deletes.
- **JSON**: the whole resource, editable
- **Issues**: the editor's own checks (duplicate codes, undeclared properties,
  wrong value types, dangling code references, count mismatches, content and
  supplements consistency...), plus `host.validate()` results if the host has it.
  Click an issue to go to it.

Only the rows in view are rendered, and hierarchies over 1000 concepts start
collapsed. Typing in a 5000-concept code system re-renders in a few ms.

## Development

```
npm install      # also builds dist/
npm test         # node --test, no browser needed
npm run demo     # build, then serve the demo at http://localhost:8765/
                 # (Open file… / Close / Recent, or drop a JSON file on the page)
npm run watch    # rebuild dist/ on change
```

### Adding an editor

1. `src/<type>/`: a `model.js` and `validation.js` (plain JS, testable in
   node), and a `<xx-editor>` element that extends `EditorBase`, with
   `static resourceType`, `validateResource()`, `normalizeResource()` and
   `render()`.
2. Sub-components get `.editor`, `.revision`, `.issues` and `.ro`, and make every
   edit through `editor.change(fn, { coalesce })`, so that undo, change
   tracking and validation all work.
3. Add `src/<type>/index.js`, an entry in `build.mjs` and an export in
   `package.json`.
4. Reuse `src/core/widgets`. ValueSet and ConceptMap will need the same coding
   input and metadata fields, so move shared pieces into `core` as they come up.
