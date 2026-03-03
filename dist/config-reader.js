import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createDebug } from './debug.js';
const debug = createDebug('config');
function getMcpServerNames(filePath) {
    if (!fs.existsSync(filePath))
        return new Set();
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const config = JSON.parse(content);
        if (config.mcpServers && typeof config.mcpServers === 'object') {
            return new Set(Object.keys(config.mcpServers));
        }
    }
    catch (error) {
        debug(`Failed to read MCP servers from ${filePath}:`, error);
    }
    return new Set();
}
function getDisabledMcpServers(filePath, key) {
    if (!fs.existsSync(filePath))
        return new Set();
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const config = JSON.parse(content);
        if (Array.isArray(config[key])) {
            const validNames = config[key].filter((s) => typeof s === 'string');
            if (validNames.length !== config[key].length) {
                debug(`${key} in ${filePath} contains non-string values, ignoring them`);
            }
            return new Set(validNames);
        }
    }
    catch (error) {
        debug(`Failed to read ${key} from ${filePath}:`, error);
    }
    return new Set();
}
function countMcpServersInFile(filePath, excludeFrom) {
    const servers = getMcpServerNames(filePath);
    if (excludeFrom) {
        const exclude = getMcpServerNames(excludeFrom);
        for (const name of exclude) {
            servers.delete(name);
        }
    }
    return servers.size;
}
function countHooksInFile(filePath) {
    if (!fs.existsSync(filePath))
        return 0;
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const config = JSON.parse(content);
        if (config.hooks && typeof config.hooks === 'object') {
            return Object.keys(config.hooks).length;
        }
    }
    catch (error) {
        debug(`Failed to read hooks from ${filePath}:`, error);
    }
    return 0;
}
function countRulesInDir(rulesDir) {
    if (!fs.existsSync(rulesDir))
        return 0;
    let count = 0;
    try {
        const entries = fs.readdirSync(rulesDir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(rulesDir, entry.name);
            if (entry.isDirectory()) {
                count += countRulesInDir(fullPath);
            }
            else if (entry.isFile() && entry.name.endsWith('.md')) {
                count++;
            }
        }
    }
    catch (error) {
        debug(`Failed to read rules from ${rulesDir}:`, error);
    }
    return count;
}
function normalizePathForComparison(inputPath) {
    let normalized = path.normalize(path.resolve(inputPath));
    const root = path.parse(normalized).root;
    while (normalized.length > root.length && normalized.endsWith(path.sep)) {
        normalized = normalized.slice(0, -1);
    }
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
function pathsReferToSameLocation(pathA, pathB) {
    if (normalizePathForComparison(pathA) === normalizePathForComparison(pathB)) {
        return true;
    }
    if (!fs.existsSync(pathA) || !fs.existsSync(pathB)) {
        return false;
    }
    try {
        const realPathA = fs.realpathSync.native(pathA);
        const realPathB = fs.realpathSync.native(pathB);
        return normalizePathForComparison(realPathA) === normalizePathForComparison(realPathB);
    }
    catch {
        return false;
    }
}
export async function countConfigs(cwd) {
    let claudeMdCount = 0;
    let rulesCount = 0;
    let hooksCount = 0;
    const homeDir = os.homedir();
    const claudeDir = path.join(homeDir, '.claude');
    // Collect all MCP servers across scopes, then subtract disabled ones
    const userMcpServers = new Set();
    const projectMcpServers = new Set();
    // === USER SCOPE ===
    // ~/.claude/CLAUDE.md
    if (fs.existsSync(path.join(claudeDir, 'CLAUDE.md'))) {
        claudeMdCount++;
    }
    // ~/.claude/rules/*.md
    rulesCount += countRulesInDir(path.join(claudeDir, 'rules'));
    // ~/.claude/settings.json (MCPs and hooks)
    const userSettings = path.join(claudeDir, 'settings.json');
    for (const name of getMcpServerNames(userSettings)) {
        userMcpServers.add(name);
    }
    hooksCount += countHooksInFile(userSettings);
    // ~/.claude.json (additional user-scope MCPs)
    const userClaudeJson = path.join(homeDir, '.claude.json');
    for (const name of getMcpServerNames(userClaudeJson)) {
        userMcpServers.add(name);
    }
    // Get disabled user-scope MCPs from ~/.claude.json
    const disabledUserMcps = getDisabledMcpServers(userClaudeJson, 'disabledMcpServers');
    for (const name of disabledUserMcps) {
        userMcpServers.delete(name);
    }
    // === PROJECT SCOPE ===
    // When cwd is the home directory (or an equivalent path to it), {cwd}/.claude/CLAUDE.md
    // overlaps with user scope ~/.claude/CLAUDE.md, so skip it to avoid double-counting.
    const isHome = cwd ? pathsReferToSameLocation(cwd, homeDir) : false;
    if (cwd) {
        // {cwd}/CLAUDE.md
        if (fs.existsSync(path.join(cwd, 'CLAUDE.md'))) {
            claudeMdCount++;
        }
        // {cwd}/CLAUDE.local.md
        if (fs.existsSync(path.join(cwd, 'CLAUDE.local.md'))) {
            claudeMdCount++;
        }
        // {cwd}/.claude/CLAUDE.md (alternative location, skip if cwd is home)
        if (!isHome && fs.existsSync(path.join(cwd, '.claude', 'CLAUDE.md'))) {
            claudeMdCount++;
        }
        // {cwd}/.claude/CLAUDE.local.md
        if (fs.existsSync(path.join(cwd, '.claude', 'CLAUDE.local.md'))) {
            claudeMdCount++;
        }
        // {cwd}/.claude/rules/*.md (recursive)
        // Skip when cwd is home because it overlaps with user-scope ~/.claude/rules.
        if (!isHome) {
            rulesCount += countRulesInDir(path.join(cwd, '.claude', 'rules'));
        }
        // {cwd}/.mcp.json (project MCP config) - tracked separately for disabled filtering
        const mcpJsonServers = getMcpServerNames(path.join(cwd, '.mcp.json'));
        // {cwd}/.claude/settings.json (project settings)
        // Skip when cwd is home because it overlaps with user-scope ~/.claude/settings.json.
        const projectSettings = path.join(cwd, '.claude', 'settings.json');
        if (!isHome) {
            for (const name of getMcpServerNames(projectSettings)) {
                projectMcpServers.add(name);
            }
            hooksCount += countHooksInFile(projectSettings);
        }
        // {cwd}/.claude/settings.local.json (local project settings)
        const localSettings = path.join(cwd, '.claude', 'settings.local.json');
        for (const name of getMcpServerNames(localSettings)) {
            projectMcpServers.add(name);
        }
        hooksCount += countHooksInFile(localSettings);
        // Get disabled .mcp.json servers from settings.local.json
        const disabledMcpJsonServers = getDisabledMcpServers(localSettings, 'disabledMcpjsonServers');
        for (const name of disabledMcpJsonServers) {
            mcpJsonServers.delete(name);
        }
        // Add remaining .mcp.json servers to project set
        for (const name of mcpJsonServers) {
            projectMcpServers.add(name);
        }
    }
    // Total MCP count = user servers + project servers
    // Note: Deduplication only occurs within each scope, not across scopes.
    // A server with the same name in both user and project scope counts as 2 (separate configs).
    const mcpCount = userMcpServers.size + projectMcpServers.size;
    return { claudeMdCount, rulesCount, mcpCount, hooksCount };
}
//# sourceMappingURL=config-reader.js.map