import { t } from '../i18n/index.js';
/**
 * Formats a usage-window reset timestamp for display in the HUD.
 *
 * @param resetAt - The reset timestamp, or null if unknown.
 * @param mode    - How to express the time:
 *   - `'relative'` (default) — duration until reset, e.g. `2h 30m`
 *   - `'absolute'`           — wall-clock time,       e.g. `at 14:30` (locale-aware)
 *   - `'both'`               — both combined,          e.g. `2h 30m, at 14:30` (locale-aware)
 * @returns A formatted string, or an empty string when the reset is in the past
 *          or the date is unknown.
 */
export function formatResetTime(resetAt, mode = 'relative') {
    if (!resetAt)
        return '';
    const now = new Date();
    const diffMs = resetAt.getTime() - now.getTime();
    if (diffMs <= 0)
        return '';
    if (mode === 'relative') {
        return formatRelative(diffMs);
    }
    const absolute = formatAbsolute(resetAt, now);
    if (mode === 'absolute') {
        return absolute;
    }
    // 'both' — comma separator avoids nested parentheses when the caller
    // wraps the result in its own (...) parenthetical
    return `${formatRelative(diffMs)}, ${absolute}`;
}
function formatRelative(diffMs) {
    const diffMins = Math.ceil(diffMs / 60000);
    if (diffMins < 60) {
        return `${diffMins}m`;
    }
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    if (hours >= 24) {
        const days = Math.floor(hours / 24);
        const remHours = hours % 24;
        return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
    }
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
function formatAbsolute(resetAt, now) {
    // The "at" prefix is i18n-aware. Locales that bake the preposition into
    // "format.resets" (e.g. zh: "重置于") set "format.at" to "" so the time
    // is returned bare ("14:30") and the preposition is supplied by the caller.
    const at = t('format.at');
    const prefix = at ? `${at} ` : '';
    const timeStr = resetAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    // Show the date only when the reset falls on a different calendar day
    if (resetAt.toDateString() === now.toDateString()) {
        return `${prefix}${timeStr}`;
    }
    const dateStr = resetAt.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `${prefix}${dateStr} ${timeStr}`;
}
//# sourceMappingURL=format-reset-time.js.map