// Preloaded into every test process (see the test scripts in package.json). The HUD and the git it
// runs read these from the environment, so a developer's own values would leak into tests that
// don't set them.
for (const name of Object.keys(process.env)) {
  if (/^(CLAUDE_|ANTHROPIC_|GIT_)/.test(name) || name === 'COLUMNS' || name === 'DEBUG') {
    delete process.env[name];
  }
}
