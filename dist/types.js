/** Check if usage limit is reached (either window at 100%) */
export function isLimitReached(data) {
    return data.fiveHour === 100 || data.sevenDay === 100;
}
//# sourceMappingURL=types.js.map