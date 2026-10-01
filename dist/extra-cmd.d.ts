export declare function isExtraCmdAllowed(env?: NodeJS.ProcessEnv): boolean;
export declare function parseExtraCmdArg(argv?: string[], env?: NodeJS.ProcessEnv): string | null;
export declare function runExtraCmd(cmd: string, timeout?: number): Promise<string | null>;
//# sourceMappingURL=extra-cmd.d.ts.map