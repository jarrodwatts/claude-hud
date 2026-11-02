// A fake GitHub API for the selftest. GETs are answered from a routes file ("GET /path?query": response;
// anything else gets []), writes get a stub PR, and every write is logged so the test can check what ACT did.
import http from 'node:http';
import fs from 'node:fs';

const [port, routesFile, logFile] = process.argv.slice(2);

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c)).on('end', () => {
    const routes = JSON.parse(fs.readFileSync(routesFile, 'utf8')); // re-read, so the test can change scenario
    const key = `${req.method} ${req.url}`;
    if (req.method !== 'GET') fs.appendFileSync(logFile, JSON.stringify({ key, auth: req.headers.authorization, body: JSON.parse(body || 'null') }) + '\n');
    const reply = routes[key] ?? (req.method === 'GET' ? [] : { number: 99, node_id: 'PR_fake' });
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(reply));
  });
}).listen(Number(port), '127.0.0.2');
