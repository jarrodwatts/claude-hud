import type { AgentEntry } from '../types.js';
import type { Frame } from './frame.js';
export type ActivityElement = 'tools' | 'skills' | 'mcp' | 'agents' | 'todos';
/** Up to three agents: running ones first, then those that finished in the last minute. */
export declare function shownAgents(agents: AgentEntry[], now: number): AgentEntry[];
export declare function activityLine(f: Frame, element: ActivityElement): string | null;
//# sourceMappingURL=activity.d.ts.map