import { describe, it, beforeEach, afterEach } from 'node:test';
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

    it('handles unknown future effort levels with empty symbol', () => {
      const result = resolveEffortLevel('turbo');
      assert.deepStrictEqual(result, { level: 'turbo', symbol: '' });
    });

    it('returns null when stdin effort is null', () => {
      const result = resolveEffortLevel(null);
      // Falls through to parent process detection (may or may not find effort)
      // We just verify it doesn't throw
      assert.ok(result === null || typeof result.level === 'string');
    });

    it('returns null when stdin effort is undefined', () => {
      const result = resolveEffortLevel(undefined);
      assert.ok(result === null || typeof result.level === 'string');
    });

    it('returns null for empty string', () => {
      const result = resolveEffortLevel('');
      assert.ok(result === null || typeof result.level === 'string');
    });
  });

  describe('stdin takes priority over parent process', () => {
    it('uses stdin value even if parent process has different effort', () => {
      const result = resolveEffortLevel('low');
      assert.strictEqual(result?.level, 'low');
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

    it('tolerates extra fields in effort object (forward-compat)', () => {
      const result = resolveEffortLevel({ level: 'max', budget: 32000, extra: 'ignored' });
      assert.deepStrictEqual(result, { level: 'max', symbol: '●' });
    });

    it('falls through when object has no level field', () => {
      const result = resolveEffortLevel({});
      assert.ok(result === null || typeof result.level === 'string');
    });

    it('falls through when object.level is null', () => {
      const result = resolveEffortLevel({ level: null });
      assert.ok(result === null || typeof result.level === 'string');
    });

    it('falls through when object.level is not a string', () => {
      const result = resolveEffortLevel({ level: 42 });
      assert.ok(result === null || typeof result.level === 'string');
    });
  });

  describe('defensive handling of unexpected types (no crash)', () => {
    it('does not crash on numeric effort value', () => {
      const result = resolveEffortLevel(42);
      assert.ok(result === null || typeof result.level === 'string');
    });

    it('does not crash on boolean effort value', () => {
      const result = resolveEffortLevel(true);
      assert.ok(result === null || typeof result.level === 'string');
    });

    it('does not crash on array effort value', () => {
      const result = resolveEffortLevel(['max']);
      assert.ok(result === null || typeof result.level === 'string');
    });
  });
});
