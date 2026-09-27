import { createElectronHost } from '../../dist/codesystem.js';

const file = new URLSearchParams(location.search).get('file');
const ed = document.getElementById('ed');
ed.host = createElectronHost({ file, terminologyServer: 'https://tx.fhir.org/r4' });

// Don't lose unsaved work when the window is closed
window.addEventListener('beforeunload', e => {
  if (ed.hasChanges) e.returnValue = false;
});
