// A tiny static server for the demo: node demo/serve.mjs [port]
// Serves the package root, so the demo can load ../dist.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || process.env.PORT || 8765);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.map': 'application/json', '.css': 'text/css', '.txt': 'text/plain' };

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url === '/') {
    res.writeHead(302, { Location: '/demo/' });
    return res.end();
  }
  let file = path.join(root, url);
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  if (url.endsWith('/')) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log(`fhir-editors demo: http://localhost:${port}/`));
