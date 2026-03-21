import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('alert-line', () => {
  it('returns null with no alerts', async () => {
    const { renderAlertLine } = await import('../dist/render/alert-line.js');
    assert.strictEqual(renderAlertLine([]), null);
  });

  it('renders single alert', async () => {
    const { renderAlertLine } = await import('../dist/render/alert-line.js');
    const result = renderAlertLine([{
      type: 'context-critical', message: 'Context 92% — ~8 calls',
      actions: { visual: true, bell: false, predict: true },
    }]);
    assert.ok(result !== null);
    const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(stripped.includes('92%'));
    assert.ok(stripped.includes('⚠'));
  });

  it('renders multiple alerts', async () => {
    const { renderAlertLine } = await import('../dist/render/alert-line.js');
    const result = renderAlertLine([
      { type: 'context-critical', message: 'Context 92%', actions: { visual: true, bell: false, predict: true } },
      { type: 'usage-5h-critical', message: 'Usage 89%', actions: { visual: true, bell: true, predict: true } },
    ]);
    assert.ok(result !== null);
    const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(stripped.includes('Context'));
    assert.ok(stripped.includes('Usage'));
  });
});
