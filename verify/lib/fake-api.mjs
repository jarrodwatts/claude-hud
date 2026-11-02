// The one fake Anthropic Messages API, on loopback, for the e2e and maintainer checks. Every reply
// carries fixed usage and the subscriber rate-limit headers, so Claude Code passes `rate_limits` to
// the status line.
//   reply(body)  the tool calls for this turn, [{ name, input }], or null for the text "mock reply"
//   usage        what every reply reports it used (the maintainer check sends zeros, which its relay can't count)
//   delay        milliseconds before each reply, so requests sent together are in flight together
//   host, port   where to listen; the maintainer check uses 127.0.0.2, which the jail can't reach
// Resolves with { port, requests, close }; each request is its parsed body plus `url` and `auth`.
import http from 'node:http';

const USAGE = { input_tokens: 1200, output_tokens: 7, cache_creation_input_tokens: 300, cache_read_input_tokens: 40000 };

export function startFakeApi({ reply = () => null, usage = USAGE, delay = 0, host = '127.0.0.1', port = 0 } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => setTimeout(() => {
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch {}
      const json = (status, value) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
      if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) return json(404, { type: 'error', error: { type: 'not_found_error', message: 'fake api' } });
      if (req.url.startsWith('/v1/messages/count_tokens')) return json(200, { input_tokens: 42 });
      requests.push({ ...body, url: req.url, auth: req.headers.authorization });
      const message = { id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: body.model ?? 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage };
      if (!body.stream) return json(200, { ...message, content: [{ type: 'text', text: 'mock reply' }], stop_reason: 'end_turn' });

      const tools = reply(body);
      const blocks = tools?.length ? tools.map((tool, i) => [{ type: 'tool_use', id: `toolu_${requests.length}_${i}`, name: tool.name, input: {} },
        { type: 'input_json_delta', partial_json: JSON.stringify(tool.input) }]) : [[{ type: 'text', text: '' }, { type: 'text_delta', text: 'mock reply' }]];
      const now = Math.floor(Date.now() / 1000);
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'anthropic-ratelimit-unified-status': 'allowed',
        'anthropic-ratelimit-unified-5h-utilization': '0.25',
        'anthropic-ratelimit-unified-5h-reset': String(now + 5400),
        'anthropic-ratelimit-unified-7d-utilization': '0.41',
        'anthropic-ratelimit-unified-7d-reset': String(now + 3 * 86400),
      });
      const events = [['message_start', { message }]];
      blocks.forEach(([block, delta], index) => events.push(['content_block_start', { index, content_block: block }],
        ['content_block_delta', { index, delta }], ['content_block_stop', { index }]));
      events.push(['message_delta', { delta: { stop_reason: tools?.length ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: usage.output_tokens } }],
        ['message_stop', {}]);
      for (const [type, data] of events) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      res.end();
    }, delay));
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve({ port: server.address().port, requests, close: () => server.close() })));
}
