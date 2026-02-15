/**
 * Serve static files from dist/ with SPA fallback. Binds to 0.0.0.0 for Docker.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 4173;
const ROOT = path.resolve(__dirname, '..', 'dist');

if (!fs.existsSync(ROOT)) {
  console.error('Missing dist folder at:', ROOT);
  process.exit(1);
}

const MIMES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const withIndex = decoded === '/' ? '/index.html' : decoded;
  const relative = withIndex.startsWith('/') ? withIndex.slice(1) : withIndex;
  const resolved = path.resolve(ROOT, relative.replace(/\.\./g, ''));
  return resolved.startsWith(ROOT) ? resolved : null;
}

const server = http.createServer((req, res) => {
  const file = safePath(req.url.split('?')[0]);
  if (!file) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err && (err.code === 'ENOENT' || err.code === 'EISDIR')) {
      fs.readFile(path.join(ROOT, 'index.html'), (err2, data2) => {
        if (err2) {
          res.writeHead(500);
          res.end('Error');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data2);
      });
      return;
    }
    if (err) {
      res.writeHead(500);
      res.end('Error');
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': MIMES[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('TerraRun static server at http://0.0.0.0:' + PORT);
});

server.on('error', (err) => {
  console.error('Server error:', err);
  process.exit(1);
});
