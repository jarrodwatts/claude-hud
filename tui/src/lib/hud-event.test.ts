import { describe, expect, it } from 'vitest';
import { parseHudEvent, parseHudEventResult } from './hud-event.js';

describe('parseHudEvent', () => {
  it('parses a valid HUD event', () => {
    const line = JSON.stringify({
      schemaVersion: 1,
      event: 'PreToolUse',
      tool: 'Read',
      toolUseId: 'tool-1',
      input: { file_path: 'README.md' },
      response: null,
      session: 's1',
      ts: 123,
      cwd: '/Users/jarrod/claude-hud',
    });
    const event = parseHudEvent(line);
    expect(event).not.toBeNull();
    expect(event?.event).toBe('PreToolUse');
    expect(event?.toolUseId).toBe('tool-1');
    expect(event?.cwd).toBe('/Users/jarrod/claude-hud');
  });

  it('accepts events without tool or input fields', () => {
    const line = JSON.stringify({
      schemaVersion: 1,
      event: 'UserPromptSubmit',
      session: 's1',
      ts: 999,
      prompt: 'Hello',
    });
    const event = parseHudEvent(line);
    expect(event).not.toBeNull();
    expect(event?.tool).toBeNull();
    expect(event?.input).toBeNull();
    expect(event?.prompt).toBe('Hello');
  });

  it('rejects invalid JSON or missing fields', () => {
    expect(parseHudEvent('not-json')).toBeNull();
    expect(parseHudEvent(JSON.stringify({ event: 'Stop' }))).toBeNull();
    expect(
      parseHudEvent(
        JSON.stringify({
          schemaVersion: 0,
          event: 'Stop',
          tool: null,
          input: null,
          response: null,
          session: 's1',
          ts: 1,
        }),
      ),
    ).toBeNull();
    expect(
      parseHudEvent(
        JSON.stringify({
          event: 'Stop',
          tool: null,
          input: null,
          response: null,
          session: 's1',
          ts: 'bad',
        }),
      ),
    ).toBeNull();
  });

  it('rejects missing schemaVersion', () => {
    const line = JSON.stringify({
      event: 'Stop',
      tool: null,
      input: null,
      response: null,
      session: 's1',
      ts: 1,
    });
    expect(parseHudEvent(line)).toBeNull();
  });

  it('accepts explicit tool: null', () => {
    const line = JSON.stringify({
      schemaVersion: 1,
      event: 'Stop',
      tool: null,
      input: null,
      response: null,
      session: 's1',
      ts: 1,
    });
    const event = parseHudEvent(line);
    expect(event).not.toBeNull();
    expect(event?.tool).toBeNull();
  });

  it('rejects malformed tool field with specific error', () => {
    const line = JSON.stringify({
      schemaVersion: 1,
      event: 'Stop',
      tool: 123,
      input: null,
      response: null,
      session: 's1',
      ts: 1,
    });
    const result = parseHudEventResult(line);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('tool');
    }
  });

  it('rejects malformed input field with specific error', () => {
    const line = JSON.stringify({
      schemaVersion: 1,
      event: 'Stop',
      tool: null,
      input: 'not-an-object',
      response: null,
      session: 's1',
      ts: 1,
    });
    const result = parseHudEventResult(line);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('input');
    }
  });

  it('rejects malformed response field with specific error', () => {
    const line = JSON.stringify({
      schemaVersion: 1,
      event: 'Stop',
      tool: null,
      input: null,
      response: 'not-an-object',
      session: 's1',
      ts: 1,
    });
    const result = parseHudEventResult(line);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('response');
    }
  });

  it('rejects non-object payload (array)', () => {
    const line = JSON.stringify(['not', 'an', 'object']);
    const result = parseHudEventResult(line);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('event_parse_failed');
      expect(result.error.message).toContain('not an object');
    }
  });

  it('rejects non-object payload (string)', () => {
    const line = JSON.stringify('just a string');
    const result = parseHudEventResult(line);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('event_parse_failed');
      expect(result.error.message).toContain('not an object');
    }
  });

  it('rejects non-object payload (number)', () => {
    const line = '42';
    const result = parseHudEventResult(line);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('event_parse_failed');
      expect(result.error.message).toContain('not an object');
    }
  });

  it('rejects non-object payload (null)', () => {
    const line = 'null';
    const result = parseHudEventResult(line);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('event_parse_failed');
      expect(result.error.message).toContain('not an object');
    }
  });

  it('rejects schema version 0 as missing', () => {
    const line = JSON.stringify({
      schemaVersion: 0,
      event: 'Stop',
      tool: null,
      input: null,
      response: null,
      session: 's1',
      ts: 1,
    });
    const result = parseHudEventResult(line);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('event_parse_failed');
    }
  });

  it('accepts and warns for schema version newer than supported', () => {
    const line = JSON.stringify({
      schemaVersion: 99,
      event: 'Stop',
      tool: null,
      input: null,
      response: null,
      session: 's1',
      ts: 1,
    });
    const result = parseHudEventResult(line);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.event).toBe('Stop');
      expect(result.warning).toBeDefined();
      expect(result.warning?.code).toBe('schema_version_mismatch');
      expect(result.warning?.message).toContain('newer than supported');
    }
  });

  it('truncates long lines in error context', () => {
    const longLine = 'x'.repeat(250);
    const result = parseHudEventResult(longLine);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.context?.linePreview).toBeDefined();
      const preview = result.error.context?.linePreview as string;
      expect(preview.length).toBeLessThan(longLine.length);
    }
  });

  it('parses optional fields like cwd, prompt, permissionMode', () => {
    const line = JSON.stringify({
      schemaVersion: 1,
      event: 'UserPromptSubmit',
      tool: null,
      input: null,
      response: null,
      session: 's1',
      ts: 123,
      cwd: '/home/user/project',
      prompt: 'Hello world',
      permissionMode: 'default',
      transcriptPath: '/tmp/transcript.json',
    });
    const result = parseHudEventResult(line);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.cwd).toBe('/home/user/project');
      expect(result.event.prompt).toBe('Hello world');
      expect(result.event.permissionMode).toBe('default');
      expect(result.event.transcriptPath).toBe('/tmp/transcript.json');
    }
  });

  it('ignores non-string optional fields', () => {
    const line = JSON.stringify({
      schemaVersion: 1,
      event: 'Stop',
      tool: null,
      input: null,
      response: null,
      session: 's1',
      ts: 123,
      cwd: 123,
      prompt: { not: 'a string' },
    });
    const result = parseHudEventResult(line);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.cwd).toBeUndefined();
      expect(result.event.prompt).toBeUndefined();
    }
  });
});
