import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('framework-line', () => {
  it('returns null when no framework status', async () => {
    const { renderFrameworkLine } = await import('../dist/render/framework-line.js');
    assert.strictEqual(renderFrameworkLine([]), null);
  });

  it('renders AGW combo status', async () => {
    const { renderFrameworkLine } = await import('../dist/render/framework-line.js');
    const result = renderFrameworkLine([{
      provider: 'AGW',
      entries: [{ label: 'review-loop', status: 'running', progress: '3/5' }],
    }]);
    assert.ok(result !== null);
    const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(stripped.includes('AGW'));
    assert.ok(stripped.includes('review-loop'));
    assert.ok(stripped.includes('3/5'));
  });

  it('renders combined AGW + Teams', async () => {
    const { renderFrameworkLine } = await import('../dist/render/framework-line.js');
    const result = renderFrameworkLine([
      { provider: 'AGW', entries: [{ label: 'pipeline', status: 'running', progress: '2/4' }] },
      { provider: 'Teams', entries: [{ label: 'fe', status: 'completed' }, { label: 'be', status: 'running' }] },
    ]);
    assert.ok(result !== null);
    const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(stripped.includes('AGW'));
    assert.ok(stripped.includes('Teams'));
  });
});
