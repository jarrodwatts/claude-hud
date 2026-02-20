import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { extractRecentMessages } from './transcript.js';

const SUMMARY_PROMPT = `Summarize the following Claude Code session in exactly 2 lines so it can be identified at a glance across multiple terminals.

Line 1: "🏷️ " + repo/project name + specific task (feature name, bug, ticket ID)
Line 2: "📍 " + the most recent concrete action — mention actual file names, function names, or commands

CRITICAL: Be concrete. Use actual names from the conversation.

❌ Bad:
🏷️ Claude Code — transcript file processing
📍 File structure analysis done, planning implementation

✅ Good:
🏷️ claude-hud — session summary bug fix
📍 Adding tool input extraction to extractRecentMessages()

❌ Bad:
🏷️ Backend API improvements
📍 Working on database optimization

✅ Good:
🏷️ acme-api — /users endpoint N+1 query fix
📍 Added preload(:posts) to UsersController#index

Rules:
- Each line max 60 characters
- Never use vague words like "working on", "improvements", "analysis done", "implementing"
- Always include actual file names, function names, or specific identifiers from the conversation
- Respond in the same language as the conversation (keep technical terms as-is)
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

function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--no-session-persistence', '--model', 'haiku'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDECODE: undefined },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`claude exited with code ${code}: ${stderr}`));
      }
    });

    child.on('error', reject);
    child.stdin.write(prompt);
    child.stdin.end();
  });
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

    const fullPrompt = `${SUMMARY_PROMPT}\n\nConversation:\n${text}`;

    const resultText = await runClaude(fullPrompt);

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
