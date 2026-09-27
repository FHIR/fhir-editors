// Bundles the editors into dist/ as ES modules with lit included, so that neither
// host needs a bundler or an import map: FHIRsmith serves dist/ as static files and
// an Electron renderer loads them with <script type="module">.
//
// Each editor is its own entry point; code shared between them (lit, src/core)
// is split into chunks so it is only loaded once.

import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: {
    'fhir-editors': 'src/index.js',
    'codesystem': 'src/codesystem/index.js'
  },
  outdir: 'dist',
  bundle: true,
  splitting: true,
  format: 'esm',
  target: ['chrome110', 'firefox115', 'safari16'],
  sourcemap: true,
  minify: !watch,
  chunkNames: 'chunks/[name]-[hash]',
  logLevel: 'info',
  legalComments: 'linked'
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
