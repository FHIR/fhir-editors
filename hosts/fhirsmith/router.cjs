// Serves the built editors from an Express app (FHIRsmith, or any other):
//
//   const { createEditorsRouter } = require('fhir-editors/fhirsmith');
//   app.use('/editors', createEditorsRouter(express));
//
// Pages then load them with
//
//   <script type="module">
//     import { createFetchHost } from '/editors/codesystem.js';
//     const ed = document.querySelector('cs-editor');
//     ed.host = createFetchHost({ loadUrl: ..., saveUrl: ..., terminologyServer: '/r4' });
//   </script>
//
// The router only serves static files; loading, saving and authorisation are
// the job of the endpoints that the page's host points at.

const path = require('path');
const fs = require('fs');

const DIST = path.join(__dirname, '..', '..', 'dist');

function createEditorsRouter(express, { maxAge = '1h' } = {}) {
  if (!fs.existsSync(path.join(DIST, 'codesystem.js'))) {
    throw new Error(`fhir-editors has not been built (no ${DIST}/codesystem.js) - run npm run build in the fhir-editors package`);
  }
  const router = express.Router();
  // chunk names include a content hash, so they can be cached for a long time
  router.use('/chunks', express.static(path.join(DIST, 'chunks'), { maxAge: '30d', immutable: true, index: false }));
  router.use(express.static(DIST, { maxAge, index: false }));
  return router;
}

module.exports = { createEditorsRouter, DIST };
