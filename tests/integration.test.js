import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";

function stripAnsi(text) {
  return text
    .replace(
      /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nq-uy=><]/g,
      "",
    )
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
}

function skipIfSpawnBlocked(result, t) {
  if (result.error?.code === "EPERM") {
    t.skip("spawnSync is blocked by sandbox policy in this environment");
    return true;
  }
  return false;
}

test("CLI renders expected output for a basic transcript", async (t) => {
  const fixturePath = fileURLToPath(
    new URL("./fixtures/transcript-render.jsonl", import.meta.url),
  );
  const expectedPath = fileURLToPath(
    new URL("./fixtures/expected/render-basic.txt", import.meta.url),
  );
  const expected = readFileSync(expectedPath, "utf8").trimEnd();

  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-hud-home-"));
  // Use a fixed 3-level path for deterministic test output
  const projectDir = path.join(homeDir, "dev", "apps", "my-project");
  await import("node:fs/promises").then((fs) =>
    fs.mkdir(projectDir, { recursive: true }),
  );
  try {
    const stdin = JSON.stringify({
      model: { display_name: "Opus" },
      context_window: {
        context_window_size: 200000,
        current_usage: { input_tokens: 45000 },
      },
      transcript_path: fixturePath,
      cwd: projectDir,
    });

    const result = spawnSync("node", ["dist/index.js"], {
      cwd: path.resolve(process.cwd()),
      input: stdin,
      encoding: "utf8",
      env: { ...process.env, HOME: homeDir, LANG: "C" },
    });

    if (skipIfSpawnBlocked(result, t)) return;

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr || "non-zero exit");
    const normalized = stripAnsi(result.stdout)
      .replace(/\u00A0/g, " ")
      .trimEnd();
    if (process.env.UPDATE_SNAPSHOTS === "1") {
      await writeFile(expectedPath, normalized + "\n", "utf8");
      return;
    }
    assert.equal(normalized, expected);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("CLI renders added_dirs basenames on the project line", async (t) => {
  const fixturePath = fileURLToPath(
    new URL("./fixtures/transcript-render.jsonl", import.meta.url),
  );
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-hud-home-"));
  const projectDir = path.join(homeDir, "dev", "apps", "my-project");
  const addedDirA = path.join(homeDir, "dev", "apps", "lib-foo");
  const addedDirB = path.join(homeDir, "dev", "apps", "some-other-repo");
  await import("node:fs/promises").then((fs) =>
    Promise.all([
      fs.mkdir(projectDir, { recursive: true }),
      fs.mkdir(addedDirA, { recursive: true }),
      fs.mkdir(addedDirB, { recursive: true }),
    ]),
  );
  try {
    const stdin = JSON.stringify({
      model: { display_name: "Opus" },
      context_window: {
        context_window_size: 200000,
        current_usage: { input_tokens: 45000 },
      },
      transcript_path: fixturePath,
      cwd: projectDir,
      workspace: {
        current_dir: projectDir,
        added_dirs: [addedDirA, addedDirB],
      },
    });

    const result = spawnSync("node", ["dist/index.js"], {
      cwd: path.resolve(process.cwd()),
      input: stdin,
      encoding: "utf8",
      env: { ...process.env, HOME: homeDir, LANG: "C" },
    });

    if (skipIfSpawnBlocked(result, t)) return;

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr || "non-zero exit");
    const firstLine = stripAnsi(result.stdout).split("\n")[0];
    assert.match(firstLine, /\+lib-foo/);
    assert.match(firstLine, /\+some-other-repo/);
    assert.ok(
      firstLine.indexOf("my-project") < firstLine.indexOf("+lib-foo"),
      "added dirs should come after the project name",
    );
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("CLI omits added dirs section when array is empty", async (t) => {
  const fixturePath = fileURLToPath(
    new URL("./fixtures/transcript-render.jsonl", import.meta.url),
  );
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-hud-home-"));
  const projectDir = path.join(homeDir, "dev", "apps", "my-project");
  await import("node:fs/promises").then((fs) =>
    fs.mkdir(projectDir, { recursive: true }),
  );
  try {
    const stdin = JSON.stringify({
      model: { display_name: "Opus" },
      context_window: {
        context_window_size: 200000,
        current_usage: { input_tokens: 45000 },
      },
      transcript_path: fixturePath,
      cwd: projectDir,
      workspace: { current_dir: projectDir, added_dirs: [] },
    });

    const result = spawnSync("node", ["dist/index.js"], {
      cwd: path.resolve(process.cwd()),
      input: stdin,
      encoding: "utf8",
      env: { ...process.env, HOME: homeDir, LANG: "C" },
    });

    if (skipIfSpawnBlocked(result, t)) return;

    assert.equal(result.status, 0, result.stderr || "non-zero exit");
    const firstLine = stripAnsi(result.stdout).split("\n")[0];
    assert.doesNotMatch(firstLine, /\+/);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("CLI tolerates added_dirs: null without crashing", async (t) => {
  const fixturePath = fileURLToPath(
    new URL("./fixtures/transcript-render.jsonl", import.meta.url),
  );
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-hud-home-"));
  const projectDir = path.join(homeDir, "dev", "apps", "my-project");
  await import("node:fs/promises").then((fs) =>
    fs.mkdir(projectDir, { recursive: true }),
  );
  try {
    const stdin = JSON.stringify({
      model: { display_name: "Opus" },
      context_window: {
        context_window_size: 200000,
        current_usage: { input_tokens: 45000 },
      },
      transcript_path: fixturePath,
      cwd: projectDir,
      workspace: { added_dirs: null },
    });

    const result = spawnSync("node", ["dist/index.js"], {
      cwd: path.resolve(process.cwd()),
      input: stdin,
      encoding: "utf8",
      env: { ...process.env, HOME: homeDir, LANG: "C" },
    });

    if (skipIfSpawnBlocked(result, t)) return;

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr || "non-zero exit");
    const firstLine = stripAnsi(result.stdout).split("\n")[0];
    assert.doesNotMatch(firstLine, /\+/);
    assert.doesNotMatch(stripAnsi(result.stdout), /Added dirs:/);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("CLI ignores non-string and post-sanitize-empty added_dirs entries", async (t) => {
  const fixturePath = fileURLToPath(
    new URL("./fixtures/transcript-render.jsonl", import.meta.url),
  );
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-hud-home-"));
  const projectDir = path.join(homeDir, "dev", "apps", "my-project");
  const validA = path.join(homeDir, "dev", "apps", "valid-one");
  const validB = path.join(homeDir, "dev", "apps", "valid-two");
  await import("node:fs/promises").then((fs) =>
    Promise.all([
      fs.mkdir(projectDir, { recursive: true }),
      fs.mkdir(validA, { recursive: true }),
      fs.mkdir(validB, { recursive: true }),
    ]),
  );
  try {
    const stdin = JSON.stringify({
      model: { display_name: "Opus" },
      context_window: {
        context_window_size: 200000,
        current_usage: { input_tokens: 45000 },
      },
      transcript_path: fixturePath,
      cwd: projectDir,
      workspace: {
        added_dirs: [validA, null, 42, "", { foo: 1 }, "‎", validB],
      },
    });

    const result = spawnSync("node", ["dist/index.js"], {
      cwd: path.resolve(process.cwd()),
      input: stdin,
      encoding: "utf8",
      env: { ...process.env, HOME: homeDir, LANG: "C" },
    });

    if (skipIfSpawnBlocked(result, t)) return;

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr || "non-zero exit");
    const firstLine = stripAnsi(result.stdout).split("\n")[0];
    assert.match(firstLine, /\+valid-one/);
    assert.match(firstLine, /\+valid-two/);
    const plusCount = (firstLine.match(/\+valid-/g) || []).length;
    assert.equal(plusCount, 2, "only the two valid basenames should render");
    assert.doesNotMatch(firstLine, /\+ /, "no bare '+' from control-char-only basename");
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("CLI caps inline added_dirs at 5 with overflow indicator", async (t) => {
  const fixturePath = fileURLToPath(
    new URL("./fixtures/transcript-render.jsonl", import.meta.url),
  );
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-hud-home-"));
  const projectDir = path.join(homeDir, "dev", "apps", "my-project");
  const dirs = Array.from({ length: 7 }, (_, i) =>
    path.join(homeDir, "dev", "apps", `dir-${i + 1}`),
  );
  await import("node:fs/promises").then((fs) =>
    Promise.all([
      fs.mkdir(projectDir, { recursive: true }),
      ...dirs.map((d) => fs.mkdir(d, { recursive: true })),
    ]),
  );
  try {
    const stdin = JSON.stringify({
      model: { display_name: "Opus" },
      context_window: {
        context_window_size: 200000,
        current_usage: { input_tokens: 45000 },
      },
      transcript_path: fixturePath,
      cwd: projectDir,
      workspace: { added_dirs: dirs },
    });

    const result = spawnSync("node", ["dist/index.js"], {
      cwd: path.resolve(process.cwd()),
      input: stdin,
      encoding: "utf8",
      env: { ...process.env, HOME: homeDir, LANG: "C" },
    });

    if (skipIfSpawnBlocked(result, t)) return;

    assert.equal(result.status, 0, result.stderr || "non-zero exit");
    const firstLine = stripAnsi(result.stdout).split("\n")[0];
    for (let i = 1; i <= 5; i++) {
      assert.match(firstLine, new RegExp(`\\+dir-${i}\\b`));
    }
    assert.doesNotMatch(firstLine, /\+dir-6\b/);
    assert.doesNotMatch(firstLine, /\+dir-7\b/);
    assert.match(firstLine, /\+2 more/);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("CLI truncates long inline added_dirs basenames", async (t) => {
  const fixturePath = fileURLToPath(
    new URL("./fixtures/transcript-render.jsonl", import.meta.url),
  );
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-hud-home-"));
  const projectDir = path.join(homeDir, "dev", "apps", "my-project");
  const longName = "a".repeat(40);
  const longDir = path.join(homeDir, "dev", "apps", longName);
  await import("node:fs/promises").then((fs) =>
    Promise.all([
      fs.mkdir(projectDir, { recursive: true }),
      fs.mkdir(longDir, { recursive: true }),
    ]),
  );
  try {
    const stdin = JSON.stringify({
      model: { display_name: "Opus" },
      context_window: {
        context_window_size: 200000,
        current_usage: { input_tokens: 45000 },
      },
      transcript_path: fixturePath,
      cwd: projectDir,
      workspace: { added_dirs: [longDir] },
    });

    const result = spawnSync("node", ["dist/index.js"], {
      cwd: path.resolve(process.cwd()),
      input: stdin,
      encoding: "utf8",
      env: { ...process.env, HOME: homeDir, LANG: "C" },
    });

    if (skipIfSpawnBlocked(result, t)) return;

    assert.equal(result.status, 0, result.stderr || "non-zero exit");
    const firstLine = stripAnsi(result.stdout).split("\n")[0];
    assert.match(firstLine, /\+a+…/, "long basename should be truncated with ellipsis");
    assert.doesNotMatch(firstLine, new RegExp(`\\+${longName}`));
    const m = firstLine.match(/\+(a+…)/);
    assert.ok(m && m[1].length <= 24, `truncated name should be ≤24 chars, got ${m && m[1].length}`);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

async function writeHudConfig(homeDir, config) {
  const fs = await import("node:fs/promises");
  const dir = path.join(homeDir, ".claude", "plugins", "claude-hud");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "config.json"), JSON.stringify(config), "utf8");
}

test("CLI renders line layout 'Added dirs:' on a separate line", async (t) => {
  const fixturePath = fileURLToPath(
    new URL("./fixtures/transcript-render.jsonl", import.meta.url),
  );
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-hud-home-"));
  const projectDir = path.join(homeDir, "dev", "apps", "my-project");
  const dirA = path.join(homeDir, "dev", "apps", "shared-utils");
  const dirB = path.join(homeDir, "dev", "apps", "mobile-app");
  await import("node:fs/promises").then((fs) =>
    Promise.all([
      fs.mkdir(projectDir, { recursive: true }),
      fs.mkdir(dirA, { recursive: true }),
      fs.mkdir(dirB, { recursive: true }),
    ]),
  );
  await writeHudConfig(homeDir, { display: { addedDirsLayout: "line" } });
  try {
    const stdin = JSON.stringify({
      model: { display_name: "Opus" },
      context_window: {
        context_window_size: 200000,
        current_usage: { input_tokens: 45000 },
      },
      transcript_path: fixturePath,
      cwd: projectDir,
      workspace: { added_dirs: [dirA, dirB] },
    });

    const result = spawnSync("node", ["dist/index.js"], {
      cwd: path.resolve(process.cwd()),
      input: stdin,
      encoding: "utf8",
      env: { ...process.env, HOME: homeDir, LANG: "C" },
    });

    if (skipIfSpawnBlocked(result, t)) return;

    assert.equal(result.status, 0, result.stderr || "non-zero exit");
    const lines = stripAnsi(result.stdout).split("\n");
    assert.doesNotMatch(lines[0], /\+shared-utils|\+mobile-app/, "inline + prefix should not appear in line mode");
    const dirsLine = lines.find((l) => l.includes("Added dirs:"));
    assert.ok(dirsLine, `expected an 'Added dirs:' line, got:\n${result.stdout}`);
    assert.match(dirsLine, /shared-utils/);
    assert.match(dirsLine, /mobile-app/);
    assert.match(dirsLine, /shared-utils,\s*mobile-app/);
    assert.doesNotMatch(dirsLine, /\bmore\b/, "two dirs should not trigger overflow");
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("CLI renders inline added_dirs even when showProject is false", async (t) => {
  const fixturePath = fileURLToPath(
    new URL("./fixtures/transcript-render.jsonl", import.meta.url),
  );
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-hud-home-"));
  const projectDir = path.join(homeDir, "dev", "apps", "my-project");
  const addedDir = path.join(homeDir, "dev", "apps", "lib-foo");
  await import("node:fs/promises").then((fs) =>
    Promise.all([
      fs.mkdir(projectDir, { recursive: true }),
      fs.mkdir(addedDir, { recursive: true }),
    ]),
  );
  await writeHudConfig(homeDir, { display: { showProject: false } });
  try {
    const stdin = JSON.stringify({
      model: { display_name: "Opus" },
      context_window: {
        context_window_size: 200000,
        current_usage: { input_tokens: 45000 },
      },
      transcript_path: fixturePath,
      cwd: projectDir,
      workspace: { added_dirs: [addedDir] },
    });

    const result = spawnSync("node", ["dist/index.js"], {
      cwd: path.resolve(process.cwd()),
      input: stdin,
      encoding: "utf8",
      env: { ...process.env, HOME: homeDir, LANG: "C" },
    });

    if (skipIfSpawnBlocked(result, t)) return;

    assert.equal(result.status, 0, result.stderr || "non-zero exit");
    const firstLine = stripAnsi(result.stdout).split("\n")[0];
    assert.match(firstLine, /\[Opus\]/, "model bracket should still render (sanity)");
    assert.doesNotMatch(firstLine, /my-project/, "project name should be hidden");
    assert.match(firstLine, /\+lib-foo/, "added dirs should still render");
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("CLI applies caps in line layout (overflow + truncation)", async (t) => {
  const fixturePath = fileURLToPath(
    new URL("./fixtures/transcript-render.jsonl", import.meta.url),
  );
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-hud-home-"));
  const projectDir = path.join(homeDir, "dev", "apps", "my-project");
  const dirs = Array.from({ length: 7 }, (_, i) =>
    path.join(homeDir, "dev", "apps", `dir-${i + 1}`),
  );
  const longName = "b".repeat(40);
  const longDir = path.join(homeDir, "dev", "apps", longName);
  await import("node:fs/promises").then((fs) =>
    Promise.all([
      fs.mkdir(projectDir, { recursive: true }),
      fs.mkdir(longDir, { recursive: true }),
      ...dirs.map((d) => fs.mkdir(d, { recursive: true })),
    ]),
  );
  await writeHudConfig(homeDir, { display: { addedDirsLayout: "line" } });
  try {
    let stdin = JSON.stringify({
      model: { display_name: "Opus" },
      context_window: {
        context_window_size: 200000,
        current_usage: { input_tokens: 45000 },
      },
      transcript_path: fixturePath,
      cwd: projectDir,
      workspace: { added_dirs: dirs },
    });
    let result = spawnSync("node", ["dist/index.js"], {
      cwd: path.resolve(process.cwd()),
      input: stdin,
      encoding: "utf8",
      env: { ...process.env, HOME: homeDir, LANG: "C" },
    });
    if (skipIfSpawnBlocked(result, t)) return;
    assert.equal(result.status, 0, result.stderr || "non-zero exit");
    let dirsLine = stripAnsi(result.stdout).split("\n").find((l) => l.includes("Added dirs:"));
    assert.ok(dirsLine, `expected 'Added dirs:' line, got:\n${result.stdout}`);
    assert.match(dirsLine, /dir-1/);
    assert.match(dirsLine, /dir-5/);
    assert.doesNotMatch(dirsLine, /dir-6/);
    assert.doesNotMatch(dirsLine, /dir-7/);
    assert.match(dirsLine, /\+2 more/);

    stdin = JSON.stringify({
      model: { display_name: "Opus" },
      context_window: {
        context_window_size: 200000,
        current_usage: { input_tokens: 45000 },
      },
      transcript_path: fixturePath,
      cwd: projectDir,
      workspace: { added_dirs: [longDir] },
    });
    result = spawnSync("node", ["dist/index.js"], {
      cwd: path.resolve(process.cwd()),
      input: stdin,
      encoding: "utf8",
      env: { ...process.env, HOME: homeDir, LANG: "C" },
    });
    if (skipIfSpawnBlocked(result, t)) return;
    assert.equal(result.status, 0, result.stderr || "non-zero exit");
    dirsLine = stripAnsi(result.stdout).split("\n").find((l) => l.includes("Added dirs:"));
    assert.ok(dirsLine, `expected 'Added dirs:' line, got:\n${result.stdout}`);
    assert.match(dirsLine, /b+…/);
    assert.doesNotMatch(dirsLine, new RegExp(longName));
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("CLI prints initializing message on empty stdin", async (t) => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-hud-home-"));

  try {
    const result = spawnSync("node", ["dist/index.js"], {
      cwd: path.resolve(process.cwd()),
      input: "",
      encoding: "utf8",
      env: { ...process.env, HOME: homeDir, LANG: "C" },
    });

    if (skipIfSpawnBlocked(result, t)) return;

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr || "non-zero exit");
    const normalized = stripAnsi(result.stdout)
      .replace(/\u00A0/g, " ")
      .trimEnd();
    assert.ok(
      normalized.startsWith("[claude-hud] Initializing..."),
      `unexpected output: ${normalized}`,
    );
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});
