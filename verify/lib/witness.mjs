// Preload for --permission-audit: Node reports every access outside the grants on these channels.
// Loaded before the fence, so it keeps its own handle on stderr.
import dc from 'node:diagnostics_channel';

const write = process._rawDebug.bind(process);
const seen = new Set();
for (const scope of ['fs', 'net', 'child', 'worker', 'inspector', 'wasi', 'addon']) {
  dc.subscribe(`node:permission-model:${scope}`, (m) => seen.add(`${m.permission} ${m.resource ?? ''}`.trim()));
}
process.on('exit', () => write(`WITNESS ${JSON.stringify([...seen])}`));
