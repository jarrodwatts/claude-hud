// A fake GitHub REST API for the maintainer check. A GET is answered from `routes`, keyed by
// "GET <path>" without the query, so a test can change the scenario by changing the object; an
// unknown GET gets an empty list, in the shape its endpoint returns. Every other request is logged
// in `writes` and answered with a stub PR.
import http from 'node:http';

export function startFakeGitHub({ routes = {}, host = '127.0.0.2' } = {}) {
  const writes = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c)).on('end', () => {
      const key = `${req.method} ${req.url.split('?')[0]}`;
      const reply = (status, value) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
      if (req.method !== 'GET') {
        writes.push({ key, auth: req.headers.authorization, body: JSON.parse(body || 'null') });
        return reply(200, { number: 99, node_id: 'PR_fake' });
      }
      if (Object.hasOwn(routes, key)) return routes[key] === 500 ? reply(500, { message: 'fake outage' }) : reply(200, routes[key]);
      const empty = key.endsWith('/runs') ? { workflow_runs: [] } : key.endsWith('/artifacts') ? { artifacts: [] } : key.endsWith('/jobs') ? { jobs: [] } : [];
      reply(200, empty);
    });
  });
  return new Promise((resolve) => server.listen(0, host, () => resolve({ url: `http://${host}:${server.address().port}`, routes, writes, close: () => server.close() })));
}
