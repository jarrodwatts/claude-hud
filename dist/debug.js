// DEBUG=claude-hud (or DEBUG=*) logs to stderr, which `claude --debug` shows for the status line.
const enabled = process.env.DEBUG?.includes('claude-hud') || process.env.DEBUG === '*';
export function createDebug(namespace) {
    return (msg, ...args) => {
        if (enabled)
            console.error(`[claude-hud:${namespace}] ${msg}`, ...args);
    };
}
//# sourceMappingURL=debug.js.map