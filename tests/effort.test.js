import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveEffortLevel } from '../dist/effort.js';

describe('resolveEffortLevel', () => {
  describe('stdin effort (future Claude Code support)', () => {
    it('returns effort info when stdin provides effort level', () => {
      const result = resolveEffortLevel('max');
      assert.deepStrictEqual(result, { level: 'max', symbol: '●' });
    });

    it('normalizes effort level to lowercase', () => {
      const result = resolveEffortLevel('HIGH');
      assert.deepStrictEqual(result, { level: 'high', symbol: '◑' });
    });

    it('handles all known effort levels', () => {
      assert.deepStrictEqual(resolveEffortLevel('low'), { level: 'low', symbol: '○' });
      assert.deepStrictEqual(resolveEffortLevel('medium'), { level: 'medium', symbol: '◔' });
      assert.deepStrictEqual(resolveEffortLevel('high'), { level: 'high', symbol: '◑' });
      assert.deepStrictEqual(resolveEffortLevel('xhigh'), { level: 'xhigh', symbol: '◕' });
      assert.deepStrictEqual(resolveEffortLevel('max'), { level: 'max', symbol: '●' });
    });

    it('wraps the reported level (not a hardcoded xhigh) when the marker is active', () => {
      const result = resolveEffortLevel('max', { ultracodeActive: true });
      assert.deepStrictEqual(result, { level: 'ultracode(max)', symbol: '●' });
    });

    it('annotates xhigh as ultracode(xhigh) when the transcript marker is active', () => {
      const result = resolveEffortLevel('xhigh', { ultracodeActive: true });
      assert.deepStrictEqual(result, { level: 'ultracode(xhigh)', symbol: '◕' });
    });

    it('keeps plain xhigh when the ultracode marker is inactive', () => {
      const result = resolveEffortLevel('xhigh', { ultracodeActive: false });
      assert.deepStrictEqual(result, { level: 'xhigh', symbol: '◕' });
    });

    it('keeps plain xhigh when no ultracode marker is present', () => {
      const result = resolveEffortLevel('xhigh');
      assert.deepStrictEqual(result, { level: 'xhigh', symbol: '◕' });
    });

    it('handles unknown future effort levels with empty symbol', () => {
      const result = resolveEffortLevel('turbo');
      assert.deepStrictEqual(result, { level: 'turbo', symbol: '' });
    });

    it('returns null when stdin effort is null', () => {
      assert.strictEqual(resolveEffortLevel(null), null);
    });

    it('returns null when stdin effort is undefined', () => {
      assert.strictEqual(resolveEffortLevel(undefined), null);
    });

    it('returns null for empty string', () => {
      assert.strictEqual(resolveEffortLevel(''), null);
    });
  });

  describe('stdin effort as object (Claude Code 2.1.115+ schema)', () => {
    it('extracts level from object { level: "max" }', () => {
      const result = resolveEffortLevel({ level: 'max' });
      assert.deepStrictEqual(result, { level: 'max', symbol: '●' });
    });

    it('extracts and normalizes uppercase level from object', () => {
      const result = resolveEffortLevel({ level: 'HIGH' });
      assert.deepStrictEqual(result, { level: 'high', symbol: '◑' });
    });

    it('handles all known levels when wrapped in object', () => {
      assert.deepStrictEqual(resolveEffortLevel({ level: 'low' }), { level: 'low', symbol: '○' });
      assert.deepStrictEqual(resolveEffortLevel({ level: 'medium' }), { level: 'medium', symbol: '◔' });
      assert.deepStrictEqual(resolveEffortLevel({ level: 'xhigh' }), { level: 'xhigh', symbol: '◕' });
    });

    it('annotates object xhigh as ultracode(xhigh) when the transcript marker is active', () => {
      const result = resolveEffortLevel({ level: 'xhigh' }, { ultracodeActive: true });
      assert.deepStrictEqual(result, { level: 'ultracode(xhigh)', symbol: '◕' });
    });

    it('tolerates extra fields in effort object (forward-compat)', () => {
      const result = resolveEffortLevel({ level: 'max', budget: 32000, extra: 'ignored' });
      assert.deepStrictEqual(result, { level: 'max', symbol: '●' });
    });

    it('returns null when object has no level field', () => {
      assert.strictEqual(resolveEffortLevel({}), null);
    });

    it('returns null when object.level is null', () => {
      assert.strictEqual(resolveEffortLevel({ level: null }), null);
    });

    it('returns null when object.level is not a string', () => {
      assert.strictEqual(resolveEffortLevel({ level: 42 }), null);
    });
  });

  describe('defensive handling of unexpected types (no crash)', () => {
    it('returns null on numeric effort value', () => {
      assert.strictEqual(resolveEffortLevel(42), null);
    });

    it('returns null on boolean effort value', () => {
      assert.strictEqual(resolveEffortLevel(true), null);
    });

    it('returns null on array effort value', () => {
      assert.strictEqual(resolveEffortLevel(['max']), null);
    });
  });
});
