import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { extractRecentMessages } from './transcript.js';

const SUMMARY_PROMPT = `Summarize the following Claude Code session in exactly 2 lines so it can be identified at a glance across multiple terminals.

Line 1: "🏷️ " + session topic/purpose (project name, feature, ticket ID — key identifiers)
Line 2: "📍 " + current status in one line

Examples:
🏷️ claude-hud plugin — adding Haiku session summary
📍 Background worker implemented, testing cache

🏷️ MCP server deploy (AI-2076) — Dockerfile optimization
📍 Addressing PR review feedback

Rules:
- Each line max 60 characters
- Keep project names, ticket IDs, and technical terms as-is
- Be specific enough to distinguish this session from others
- Respond in the same language as the conversation (e.g., if the conversation is in Korean, write the summary in Korean — but keep technical terms, project names, and ticket IDs in their original form)
- Output exactly 2 lines, nothing else`;

function getPluginDir(): string {
  return path.join(os.homedir(), '.claude', 'plugins', 'claude-hud');
}

function sessionHash(transcriptPath: string): string {
  return createHash('md5').update(transcriptPath).digest('hex').slice(0, 8);
}

function writeLock(transcriptPath: string): void {
  fs.writeFileSync(path.join(getPluginDir(), `.summary-${sessionHash(transcriptPath)}.lock`), String(Date.now()), 'utf8');
}

function removeLock(transcriptPath: string): void {
  try { fs.unlinkSync(path.join(getPluginDir(), `.summary-${sessionHash(transcriptPath)}.lock`)); } catch { /* ignore */ }
}

async function main(): Promise<void> {
  const transcriptPath = process.argv[2];
  const turnCount = parseInt(process.argv[3], 10);

  if (!transcriptPath || isNaN(turnCount)) {
    process.exit(1);
  }

  delete process.env['CLAUDECODE'];

  writeLock(transcriptPath);

  try {
    const { text } = await extractRecentMessages(transcriptPath, 10);
    if (!text) {
      removeLock(transcriptPath);
      process.exit(0);
    }

    const { query } = await import('@anthropic-ai/claude-agent-sdk');

    const fullPrompt = `${SUMMARY_PROMPT}\n\nConversation:\n${text}`;

    const cleanEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (key !== 'CLAUDECODE' && value !== undefined) {
        cleanEnv[key] = value;
      }
    }

    const conversation = query({
      prompt: fullPrompt,
      options: {
        model: 'haiku',
        maxTurns: 1,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        dangerouslySkipSave: true,
        env: cleanEnv,
      },
    });

    let resultText = '';
    for await (const message of conversation) {
      if (message.type === 'result' && message.subtype === 'success') {
        resultText = message.result;
        break;
      }
    }

    if (resultText) {
      const lines = resultText.split('\n').filter((l: string) => l.trim().length > 0);
      let summary: [string, string];
      if (lines.length >= 2) {
        summary = [lines[0], lines[1]];
      } else if (lines.length === 1) {
        summary = [lines[0], '📍 ...'];
      } else {
        removeLock(transcriptPath);
        process.exit(0);
        return;
      }

      const cache = {
        lastTurnCount: turnCount,
        turnCount,
        summary,
        timestamp: Date.now(),
      };

      const cachePath = path.join(getPluginDir(), `.summary-${sessionHash(transcriptPath)}.json`);
      fs.writeFileSync(cachePath, JSON.stringify(cache), 'utf8');
    }
  } catch {
    // silently fail
  } finally {
    removeLock(transcriptPath);
  }
}

main();
