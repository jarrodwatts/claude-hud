// Golden cases: each renders `node dist/index.js` end to end. Placeholders
// <PROJECT>, <TRANSCRIPT>, and <HOME> are filled in by golden.test.js.
export const NOW_MS = Date.parse('2026-10-01T12:00:00.000Z');
const NOW = NOW_MS / 1000;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function merge(base, patch) {
  if (!isObject(base) || !isObject(patch)) return patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = v === undefined ? undefined : merge(base[k], v);
  return out;
}

const typical = {
  session_id: 'golden-session',
  transcript_path: '<TRANSCRIPT>',
  cwd: '<PROJECT>',
  workspace: { current_dir: '<PROJECT>', project_dir: '<PROJECT>', added_dirs: [] },
  model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
  version: '2.1.286',
  output_style: { name: 'default' },
  cost: {
    total_cost_usd: 1.2345,
    total_duration_ms: 3_600_000,
    total_api_duration_ms: 600_000,
    total_lines_added: 156,
    total_lines_removed: 23,
  },
  context_window: {
    total_input_tokens: 90_000,
    total_output_tokens: 1_200,
    context_window_size: 200_000,
    used_percentage: 45,
    remaining_percentage: 55,
    current_usage: {
      input_tokens: 8_000,
      output_tokens: 1_200,
      cache_creation_input_tokens: 2_000,
      cache_read_input_tokens: 80_000,
    },
  },
  exceeds_200k_tokens: false,
  rate_limits: {
    five_hour: { used_percentage: 25, resets_at: NOW + 5_400 },
    seven_day: { used_percentage: 41.2, resets_at: NOW + 3 * 86_400 + 3_600 },
  },
};

const rich = merge(typical, {
  session_name: 'auth-fix',
  effort: { level: 'high' },
  thinking: { enabled: true },
  fast_mode: false,
  output_style: { name: 'Explanatory' },
  workspace: {
    git_worktree: 'feat-auth',
    repo: { host: 'github.com', owner: 'jarrodwatts', name: 'claude-hud' },
  },
  prompt_cache: {
    warm: true,
    caching_observed: true,
    ttl: '5m',
    expires_at: NOW + 240,
    requests: 10,
    misses: 1,
    hit_ratio: 0.91,
  },
  pr: { number: 1234, url: 'https://github.com/jarrodwatts/claude-hud/pull/1234', review_state: 'pending' },
});

const stdin = {
  typical,
  rich,
  minimal: { model: { display_name: 'Opus' }, cwd: '<PROJECT>' },
  apiUser: merge(typical, { rate_limits: undefined }),
  contextWarning: merge(typical, { context_window: { used_percentage: 75, remaining_percentage: 25 } }),
  contextCritical: merge(typical, {
    context_window: {
      total_input_tokens: 184_000,
      used_percentage: 92,
      remaining_percentage: 8,
      current_usage: { input_tokens: 12_000, cache_creation_input_tokens: 4_000, cache_read_input_tokens: 168_000 },
    },
  }),
  nullContext: merge(typical, {
    context_window: { used_percentage: null, remaining_percentage: null, current_usage: null, total_input_tokens: 0 },
  }),
  zeroPercentLiveUsage: merge(typical, { context_window: { used_percentage: 0, remaining_percentage: 100 } }),
  oneMillion: merge(typical, {
    model: { id: 'claude-opus-5-5[1m]', display_name: 'Opus 5.5 (1M context)' },
    context_window: { context_window_size: 1_000_000, used_percentage: 9, remaining_percentage: 91 },
  }),
  limitReached: merge(typical, { rate_limits: { five_hour: { used_percentage: 100, resets_at: NOW + 1_800 } } }),
  weeklyHigh: merge(typical, { rate_limits: { seven_day: { used_percentage: 85, resets_at: NOW + 86_400 } } }),
  spendLimit: merge(typical, { rate_limits: { spend_limit: { used_percentage: 62.8, resets_at: NOW + 20 * 86_400 } } }),
  addedDirs: merge(typical, { workspace: { added_dirs: ['/work/shared-lib', '/work/docs'] } }),
  bedrock: merge(apiUserBase(), { model: { id: 'us.anthropic.claude-opus-5-5-v1:0', display_name: 'Opus 5.5' } }),
};

function apiUserBase() {
  return merge(typical, { rate_limits: undefined });
}

const KITCHEN_SINK = {
  gitStatus: { showAheadBehind: true, showFileStats: true, showWorktree: true },
  display: {
    showTools: true,
    showAgents: true,
    showTodos: true,
    showSkills: true,
    showMcp: true,
    showCost: true,
    showDailyCost: true,
    showWeeklyCost: true,
    showDuration: true,
    showSpeed: true,
    showSessionName: true,
    showClaudeCodeVersion: true,
    showEffortLevel: true,
    showPromptCache: true,
    showCacheHitRate: true,
    showSessionTokens: true,
    showOutputStyle: true,
    showSessionStartDate: true,
    showLastResponseAt: true,
    showCompactions: true,
    showAdvisor: true,
    showConfigCounts: true,
    usagePace: true,
  },
};

const options = {
  'contextValue=tokens': { display: { contextValue: 'tokens' } },
  'contextValue=remaining': { display: { contextValue: 'remaining' } },
  'contextValue=both': { display: { contextValue: 'both' } },
  'showContextBar=false': { display: { showContextBar: false } },
  'showTokenBreakdown=false': { display: { showTokenBreakdown: false } },
  'contextThresholds=50/60': { display: { contextWarningThreshold: 50, contextCriticalThreshold: 60 } },
  'autocompactBuffer=disabled': { display: { autocompactBuffer: 'disabled' } },
  'autoCompactWindow=160000': { display: { autoCompactWindow: 160_000 } },
  'usageValue=remaining': { display: { usageValue: 'remaining' } },
  'usageBarEnabled=false': { display: { usageBarEnabled: false } },
  'usageCompact=true': { display: { usageCompact: true } },
  'showResetLabel=false': { display: { showResetLabel: false } },
  'timeFormat=absolute': { display: { timeFormat: 'absolute' } },
  'timeFormat=both': { display: { timeFormat: 'both' } },
  'timeFormat=elapsed': { display: { timeFormat: 'elapsed' } },
  'timeFormat=elapsedAndAbsolute': { display: { timeFormat: 'elapsedAndAbsolute' } },
  'hourCycle=h12+seconds': { display: { timeFormat: 'absolute', hourCycle: 'h12', showClockSeconds: true } },
  'usageThreshold=50': { display: { usageThreshold: 50 } },
  'sevenDayThreshold=0': { display: { sevenDayThreshold: 0 } },
  'showUsage=false': { display: { showUsage: false } },
  'usagePace=true': { display: { usagePace: true } },
  'modelFormat=compact': { display: { modelFormat: 'compact' } },
  'modelFormat=short': { display: { modelFormat: 'short' } },
  'modelOverride': { display: { modelOverride: 'My Model' } },
  'showProvider+providerName': { display: { showProvider: true, providerName: 'Acme Proxy' } },
  'showModel=false': { display: { showModel: false } },
  'showProject=false': { display: { showProject: false } },
  'pathLevels=2': { pathLevels: 2 },
  'addedDirsLayout=line': { display: { addedDirsLayout: 'line' } },
  'showAddedDirs=false': { display: { showAddedDirs: false } },
  'elementOrder=usage,context,project': { elementOrder: ['usage', 'context', 'project'] },
  'mergeGroups=[]': { display: { mergeGroups: [] } },
  'mergeGroups=project+context+usage': { display: { mergeGroups: [['project', 'context', 'usage']] } },
  'rightAlign=context': { display: { mergeGroups: [['project', 'context', 'usage']], rightAlign: ['context'] } },
  'projectLineOrder': {
    projectLineOrder: ['project', 'model', 'cost'],
    display: { showCost: true },
  },
  'customLine=first': { display: { customLine: 'ship it', customLinePosition: 'first' } },
  'customLine=last': { display: { customLine: 'ship it' } },
  'maxWidth=60': { maxWidth: 60 },
  'language=zh-Hans': { language: 'zh-Hans' },
  'language=zh-Hant': { language: 'zh-Hant' },
  'colors': {
    colors: { context: '#00ff88', usage: 141, warning: 'brightMagenta', model: 'red', barFilled: '■', barEmpty: '·' },
  },
  'effortFormat=symbol': { display: { showEffortLevel: true, effortFormat: 'symbol' } },
  'effortFormat=text': { display: { showEffortLevel: true, effortFormat: 'text' } },
  'toolsMaxVisible=2+toolNameMaxLength=6': { display: { showTools: true, toolsMaxVisible: 2, toolNameMaxLength: 6 } },
  'skillsMaxVisible=1': { display: { showSkills: true, skillsMaxVisible: 1 } },
  'gitStatus.enabled=false': { gitStatus: { enabled: false } },
  'gitStatus.showDirty=false': { gitStatus: { showDirty: false } },
  'branchOverflow=wrap': { gitStatus: { branchOverflow: 'wrap' } },
};

const SINGLE_TOGGLES = Object.keys(KITCHEN_SINK.display).map((key) => [key, { display: { [key]: true } }]);

const cases = [];
const add = (name, spec) => cases.push({ name, ...spec });

for (const [name, s] of Object.entries(stdin)) add(`default/${name}`, { stdin: s });
for (const columns of [40, 60, 80, 120]) add(`default/typical@${columns}`, { stdin: typical, columns });
add('default/git-clean', { stdin: typical, git: 'clean' });
add('default/git-dirty', { stdin: typical, git: 'dirty' });
add('default/git-dirty@40', { stdin: typical, git: 'dirty', columns: 40 });

for (const [name, config] of Object.entries(options)) {
  add(`option/${name}`, { stdin: rich, config, git: config.gitStatus ? 'dirty' : undefined });
}
for (const [name, config] of SINGLE_TOGGLES) add(`toggle/${name}`, { stdin: rich, config });
add('toggle/showRoutedCost+bedrock', { stdin: stdin.bedrock, config: { display: { showCost: true, showRoutedCost: true } } });
add('toggle/showCost+bedrock', { stdin: stdin.bedrock, config: { display: { showCost: true } } });

for (const columns of [undefined, 60, 120]) {
  const at = columns ? `@${columns}` : '';
  add(`kitchen-sink/expanded${at}`, { stdin: rich, config: KITCHEN_SINK, git: 'dirty', columns });
  add(`kitchen-sink/compact${at}`, {
    stdin: rich,
    config: { ...KITCHEN_SINK, lineLayout: 'compact' },
    git: 'dirty',
    columns,
  });
}
add('kitchen-sink/compact+separators', {
  stdin: rich,
  config: { ...KITCHEN_SINK, lineLayout: 'compact', showSeparators: true },
  git: 'dirty',
});
add('kitchen-sink/zh-Hans', { stdin: rich, config: { ...KITCHEN_SINK, language: 'zh-Hans' }, git: 'dirty' });

for (const name of ['typical', 'apiUser', 'contextCritical', 'limitReached', 'nullContext', 'minimal']) {
  add(`compact/${name}`, { stdin: stdin[name], config: { lineLayout: 'compact' } });
}
add('compact/git-dirty@40', { stdin: typical, config: { lineLayout: 'compact' }, git: 'dirty', columns: 40 });
add('compact/usageCompact', { stdin: typical, config: { lineLayout: 'compact', display: { usageCompact: true } } });

export default cases;
