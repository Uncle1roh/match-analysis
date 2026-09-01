/* Serve this folder on http://localhost:3000.

   Not a convenience: the tools have to be served over http for signing in to
   work at all. A sign-in link has to come back to an address on the project's
   allow-list, and file:// can never be one. Port 3000 is on that list.

   Usage: node tools/serve.mjs [port]
*/
import http from 'http';
import fs from 'fs';
import path from 'path';

const port = parseInt(process.argv[2] || '3000', 10);
const root = process.cwd();
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.pdf': 'application/pdf', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.txt': 'text/plain; charset=utf-8'
};

http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  if (rel === '/') rel = '/index.html';
  /* clean URLs, the way vercel.json serves them */
  let file = path.join(root, rel);
  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
  /* never serve outside the folder */
  if (!path.resolve(file).startsWith(path.resolve(root))) { res.writeHead(403); return res.end('no'); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not here: ' + rel);
  }
  const st = fs.statSync(file);
  res.writeHead(200, {
    'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
    'content-length': st.size,
    'x-robots-tag': 'noindex, nofollow'
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}).listen(port, () => {
  console.log(`serving this folder at http://localhost:${port}`);
  console.log(`  tagger  http://localhost:${port}/tagger.html`);
  console.log(`  finder  http://localhost:${port}/finder.html`);
  console.log('\nctrl-c to stop');
});
