// A fake Anthropic API that plays a scripted model. Each main-loop call returns the next tool call from
// the steps file; once the steps run out it repeats the first one forever, which is how a budget gets spent.
// It logs what reached it, so the selftest can check that the relay swapped the token and pinned the model.
// It listens on 127.0.0.2 because the jail lets `agent` reach 127.0.0.1 only: the agent can't skip the relay.
import http from 'node:http';
import fs from 'node:fs';

const [port, stepsFile, logFile] = process.argv.slice(2);
const steps = JSON.parse(fs.readFileSync(stepsFile, 'utf8'));
let i = 0;

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c)).on('end', () => {
    const p = JSON.parse(body || '{}');
    const tools = (p.tools ?? []).map((t) => t.name);
    fs.appendFileSync(logFile, JSON.stringify({ url: req.url, auth: req.headers.authorization, model: p.model, tools }) + '\n');
    const usage = { input_tokens: 100, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
    const message = { id: `msg_${i}`, type: 'message', role: 'assistant', model: p.model, content: [], stop_reason: null, usage };
    if (!p.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ...message, content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }));
    }
    const step = tools.length ? (steps[i++] ?? steps[0]) : null; // side calls (titles etc.) get plain text
    const block = step ? { type: 'tool_use', id: `toolu_${i}`, name: step.tool, input: {} } : { type: 'text', text: '' };
    const delta = step ? { type: 'input_json_delta', partial_json: JSON.stringify(step.input) } : { type: 'text_delta', text: 'ok' };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const [type, data] of [
      ['message_start', { message }],
      ['content_block_start', { index: 0, content_block: block }],
      ['content_block_delta', { index: 0, delta }],
      ['content_block_stop', { index: 0 }],
      ['message_delta', { delta: { stop_reason: step ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 50 } }],
      ['message_stop', {}],
    ]) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    res.end();
  });
}).listen(Number(port), '127.0.0.2');
