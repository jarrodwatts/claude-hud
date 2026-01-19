export const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
export function green(text) {
    return `${GREEN}${text}${RESET}`;
}
export function yellow(text) {
    return `${YELLOW}${text}${RESET}`;
}
export function red(text) {
    return `${RED}${text}${RESET}`;
}
export function cyan(text) {
    return `${CYAN}${text}${RESET}`;
}
export function magenta(text) {
    return `${MAGENTA}${text}${RESET}`;
}
export function dim(text) {
    return `${DIM}${text}${RESET}`;
}
export function getContextColor(percent) {
    if (percent >= 85)
        return RED;
    if (percent >= 70)
        return YELLOW;
    return GREEN;
}
export function coloredBar(percent, width = 10) {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    const color = getContextColor(percent);
    return `${color}${'█'.repeat(filled)}${DIM}${'░'.repeat(empty)}${RESET}`;
}
//# sourceMappingURL=colors.js.map