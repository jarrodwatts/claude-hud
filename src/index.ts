// Every launcher, the one `hud install` copies today included, imports this file on Bun (dist/index.js
// on Node) and calls main(), or runs it directly. The HUD itself is hud.mjs; this is how launchers enter it.
export { main } from '../hud.mjs';
