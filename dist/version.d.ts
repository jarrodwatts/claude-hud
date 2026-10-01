type ExecFileResult = {
    stdout: string;
};
type ExecFileImpl = (file: string, args: string[], options: {
    timeout: number;
    encoding: BufferEncoding;
    windowsHide?: boolean;
}) => Promise<ExecFileResult>;
type ClaudeBinaryInfo = {
    path: string;
    mtimeMs: number;
};
type ClaudeVersionInvocation = {
    file: string;
    args: string[];
};
export declare function _parseClaudeCodeVersion(output: string): string | undefined;
export declare function _getClaudeVersionInvocation(binaryPath: string, platform?: NodeJS.Platform, windowsCmd?: string): ClaudeVersionInvocation;
export declare function resolveStdinClaudeCodeVersion(value: unknown): string | undefined;
export declare function getClaudeCodeVersion(): Promise<string | undefined>;
export declare function _resetVersionCache(): void;
export declare function _setExecFileImplForTests(impl: ExecFileImpl | null): void;
export declare function _setResolveClaudeBinaryForTests(impl: (() => ClaudeBinaryInfo | null) | null): void;
export declare function _setVersionInvocationEnvForTests(platformGetter: (() => NodeJS.Platform) | null, windowsCmdGetter: (() => string) | null): void;
export {};
//# sourceMappingURL=version.d.ts.map