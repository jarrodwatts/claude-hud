import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventReader } from './event-reader.js';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('EventReader', () => {
  it('emits events for valid JSON lines and ignores invalid ones', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
    const filePath = path.join(tmpDir, 'events.log');
    const lines = [
      JSON.stringify({
        schemaVersion: 1,
        event: 'PostToolUse',
        tool: 'Read',
        input: { file_path: '/tmp/test.txt' },
        response: null,
        session: 'test',
        ts: Date.now() / 1000,
      }),
      'not json',
      JSON.stringify({
        schemaVersion: 99,
        event: 'PostToolUse',
        tool: 'Read',
        input: { file_path: '/tmp/test.txt' },
        response: null,
        session: 'test',
        ts: Date.now() / 1000,
      }),
      JSON.stringify({
        schemaVersion: 1,
        event: 'UserPromptSubmit',
        tool: null,
        input: null,
        response: null,
        session: 'test',
        ts: Date.now() / 1000,
        prompt: 'hello',
      }),
    ];
    fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf-8');

    const reader = new EventReader(filePath);
    const events: Array<{ event: string }> = [];
    const errors: Array<{ code: string }> = [];
    reader.on('event', (event) => events.push(event));
    reader.on('parseError', (error) => errors.push(error));

    await wait(50);
    reader.close();

    expect(events).toHaveLength(3);
    expect(events[0].event).toBe('PostToolUse');
    expect(events[1].event).toBe('PostToolUse');
    expect(events[2].event).toBe('UserPromptSubmit');
    expect(errors.length).toBeGreaterThanOrEqual(2);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('emits status changes for connect and disconnect', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
    const filePath = path.join(tmpDir, 'events.log');
    fs.writeFileSync(filePath, '{}\n', 'utf-8');

    const reader = new EventReader(filePath);
    const statuses: string[] = [];
    reader.on('status', (status) => statuses.push(status));

    await wait(50);
    reader.close();

    expect(statuses).toContain('connected');
    expect(statuses).toContain('disconnected');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('tracks last event time', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
    const filePath = path.join(tmpDir, 'events.log');
    const event = JSON.stringify({
      schemaVersion: 1,
      event: 'PostToolUse',
      tool: 'Read',
      input: null,
      response: null,
      session: 'test',
      ts: Date.now() / 1000,
    });
    fs.writeFileSync(filePath, `${event}\n`, 'utf-8');

    const reader = new EventReader(filePath);
    expect(reader.getLastEventTime()).toBe(0);

    await wait(50);
    expect(reader.getLastEventTime()).toBeGreaterThan(0);

    reader.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('switches to a new fifo path', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
    const filePath1 = path.join(tmpDir, 'events1.log');
    const filePath2 = path.join(tmpDir, 'events2.log');

    fs.writeFileSync(
      filePath1,
      JSON.stringify({
        schemaVersion: 1,
        event: 'Stop',
        tool: null,
        input: null,
        response: null,
        session: 'test1',
        ts: 1,
      }) + '\n',
      'utf-8',
    );
    fs.writeFileSync(
      filePath2,
      JSON.stringify({
        schemaVersion: 1,
        event: 'PreCompact',
        tool: null,
        input: null,
        response: null,
        session: 'test2',
        ts: 2,
      }) + '\n',
      'utf-8',
    );

    const reader = new EventReader(filePath1);
    const events: Array<{ event: string }> = [];
    reader.on('event', (event) => events.push(event));

    await wait(50);
    expect(events.some((e) => e.event === 'Stop')).toBe(true);

    reader.switchFifo(filePath2);
    await wait(100);

    expect(events.some((e) => e.event === 'PreCompact')).toBe(true);

    reader.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns initial status as connecting', () => {
    const reader = new EventReader('/tmp/nonexistent-fifo-path-12345');
    expect(reader.getStatus()).toBe('connecting');
    reader.close();
  });

  it('transitions through status states', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
    const filePath = path.join(tmpDir, 'events.log');
    fs.writeFileSync(filePath, '', 'utf-8');

    const reader = new EventReader(filePath);
    const statuses: string[] = [];
    reader.on('status', (status) => statuses.push(status));

    await wait(100);
    reader.close();

    expect(statuses).toContain('connected');
    expect(reader.getStatus()).toBe('disconnected');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('waits for file to exist before connecting', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
    const filePath = path.join(tmpDir, 'delayed.log');

    const reader = new EventReader(filePath);
    const statuses: string[] = [];
    reader.on('status', (status) => statuses.push(status));

    expect(reader.getStatus()).toBe('connecting');

    await wait(100);
    fs.writeFileSync(filePath, '', 'utf-8');
    await wait(600);

    expect(statuses).toContain('connected');

    reader.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throttles duplicate parse errors', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
    const filePath = path.join(tmpDir, 'events.log');

    const invalidLines = Array(10).fill('invalid json').join('\n') + '\n';
    fs.writeFileSync(filePath, invalidLines, 'utf-8');

    const reader = new EventReader(filePath);
    const errors: Array<{ code: string; message: string }> = [];
    reader.on('parseError', (error) => errors.push(error));

    await wait(50);
    reader.close();

    expect(errors.length).toBeLessThan(10);
    expect(errors.length).toBeGreaterThan(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
