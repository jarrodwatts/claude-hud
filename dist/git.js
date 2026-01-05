import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
export async function getGitBranch(cwd) {
    if (!cwd)
        return null;
    try {
        const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 1000, encoding: 'utf8' });
        return stdout.trim() || null;
    }
    catch {
        return null;
    }
}
export async function getGitDirty(cwd) {
    if (!cwd)
        return false;
    try {
        const { stdout } = await execFileAsync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd, timeout: 1000, encoding: 'utf8' });
        return stdout.trim().length > 0;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=git.js.map