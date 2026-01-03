import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { parseHudEventResult, type HudEventParseError } from './hud-event.js';
import { logger } from './logger.js';
import {
  MAX_RECONNECT_DELAY_MS,
  INITIAL_RECONNECT_DELAY_MS,
  RECONNECT_BACKOFF_FACTOR,
  ERROR_THROTTLE_MS,
} from './constants.js';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export class EventReader extends EventEmitter {
  private stream: ReturnType<typeof createReadStream> | null = null;
  private rl: ReturnType<typeof createInterface> | null = null;
  private closed = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = Number.POSITIVE_INFINITY;
  private status: ConnectionStatus = 'connecting';
  private lastEventTime: number = 0;
  private lastParseErrorAt = 0;
  private lastParseErrorKey = '';

  constructor(private fifoPath: string) {
    super();
    this.connect();
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getLastEventTime(): number {
    return this.lastEventTime;
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.emit('status', status);
    }
  }

  private connect(): void {
    if (this.closed) return;

    if (!existsSync(this.fifoPath)) {
      this.setStatus('connecting');
      setTimeout(() => this.connect(), 500);
      return;
    }

    try {
      // Use 'r+' (O_RDWR) flag - this doesn't block on FIFOs unlike 'r' (O_RDONLY)
      // because the process itself counts as a potential writer
      this.stream = createReadStream(this.fifoPath, { encoding: 'utf-8', flags: 'r+' });
      this.rl = createInterface({ input: this.stream });

      this.stream.once('open', () => {
        this.setStatus('connected');
        this.reconnectAttempts = 0;
      });

      this.rl.on('line', (line: string) => {
        if (!line.trim()) return;
        const parsed = parseHudEventResult(line);
        if (!parsed.ok) {
          this.emitParseError(parsed.error);
          return;
        }
        if (parsed.warning) {
          this.emitParseError(parsed.warning);
        }
        const event = parsed.event;
        this.lastEventTime = Date.now();
        this.emit('event', event);
      });

      this.stream.on('end', () => {
        this.cleanup();
        if (!this.closed) {
          this.setStatus('disconnected');
          this.scheduleReconnect();
        }
      });

      this.stream.on('error', () => {
        this.cleanup();
        if (!this.closed) {
          this.setStatus('error');
          this.scheduleReconnect();
        }
      });
    } catch (err) {
      logger.error('EventReader', 'Failed to connect to FIFO', err);
      this.setStatus('error');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setStatus('error');
      return;
    }

    this.reconnectAttempts = Math.min(this.reconnectAttempts + 1, 1_000_000);
    const delay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * Math.pow(RECONNECT_BACKOFF_FACTOR, this.reconnectAttempts),
      MAX_RECONNECT_DELAY_MS,
    );
    setTimeout(() => this.connect(), delay);
  }

  private cleanup(): void {
    this.rl?.close();
    this.rl = null;
    this.stream?.destroy();
    this.stream = null;
  }

  private emitParseError(error: HudEventParseError): void {
    const now = Date.now();
    const key = `${error.code}:${error.message}`;
    if (this.lastParseErrorKey === key && now - this.lastParseErrorAt < ERROR_THROTTLE_MS) {
      return;
    }
    this.lastParseErrorAt = now;
    this.lastParseErrorKey = key;
    logger.warn('EventReader', 'Failed to parse HUD event line', error);
    this.emit('parseError', error);
  }

  close(): void {
    this.closed = true;
    this.cleanup();
    this.setStatus('disconnected');
  }

  switchFifo(newFifoPath: string): void {
    this.cleanup();
    this.fifoPath = newFifoPath;
    this.reconnectAttempts = 0;
    this.closed = false;
    this.setStatus('connecting');
    this.connect();
  }
}
