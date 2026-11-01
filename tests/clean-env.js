// Preloaded into every test process (see the test scripts in package.json). The HUD reads these
// from the environment, so a developer's own values would leak into tests that don't set them.
for (const name of ['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_PLUGIN_CACHE_DIR', 'COLUMNS', 'DEBUG']) {
  delete process.env[name];
}
