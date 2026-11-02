// A fake Anthropic Messages API on loopback. Every reply is "mock reply" with fixed usage, and carries
// the subscriber rate-limit headers, so Claude Code passes `rate_limits` to the status line.
import http from 'node:http';

export function startFakeApi() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push(`${req.method} ${req.url}`);
      let model = 'claude-sonnet-5-5';
      let stream = false;
      try {
        ({ model = model, stream = false } = JSON.parse(body));
      } catch {}
      const json = (status, value) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
      if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) return json(404, { type: 'error', error: { type: 'not_found_error', message: 'fake api' } });
      if (req.url.startsWith('/v1/messages/count_tokens')) return json(200, { input_tokens: 42 });
      const usage = { input_tokens: 1200, output_tokens: 7, cache_creation_input_tokens: 300, cache_read_input_tokens: 40000 };
      const message = { id: 'msg_fake', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage };
      if (!stream) return json(200, { ...message, content: [{ type: 'text', text: 'mock reply' }], stop_reason: 'end_turn' });
      const now = Math.floor(Date.now() / 1000);
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'anthropic-ratelimit-unified-status': 'allowed',
        'anthropic-ratelimit-unified-5h-utilization': '0.25',
        'anthropic-ratelimit-unified-5h-reset': String(now + 5400),
        'anthropic-ratelimit-unified-7d-utilization': '0.41',
        'anthropic-ratelimit-unified-7d-reset': String(now + 3 * 86400),
      });
      const events = [
        ['message_start', { message }],
        ['content_block_start', { index: 0, content_block: { type: 'text', text: '' } }],
        ['content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'mock reply' } }],
        ['content_block_stop', { index: 0 }],
        ['message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 7 } }],
        ['message_stop', {}],
      ];
      for (const [type, data] of events) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, requests, close: () => server.close() })));
}
