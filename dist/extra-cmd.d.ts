export interface ExtraLabel {
    label: string;
}
export declare function isExtraCmdAllowed(env?: NodeJS.ProcessEnv): boolean;
/**
 * Sanitize output to prevent terminal escape injection.
 * Strips ANSI escapes, OSC sequences, control characters, and bidi controls.
 */
export declare function sanitize(input: string): string;
/**
 * Parse --extra-cmd argument from process.argv
 * Supports both: --extra-cmd "command" and --extra-cmd="command"
 */
export declare function parseExtraCmdArg(argv?: string[], env?: NodeJS.ProcessEnv): string | null;
/**
 * Execute a command and parse output.
 *
 * Preferred output is JSON shaped as { label: string }. For simple local
 * checks such as `npm test`, plain stdout is also accepted and summarized
 * from the last non-empty line.
 *
 * Returns null on command errors, timeouts, or empty output.
 *
 * SECURITY NOTE: The cmd parameter is sourced exclusively from CLI arguments
 * (--extra-cmd) typed by the user. Since the user controls their own shell,
 * shell injection is not a concern here - it's intentional user input.
 */
export declare function runExtraCmd(cmd: string, timeout?: number): Promise<string | null>;
//# sourceMappingURL=extra-cmd.d.ts.map