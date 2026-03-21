export type Locale = 'en' | 'zh' | 'ja';

interface Labels {
  context: string;
  usage: string;
  tools: string;
  agents: string;
  todos: string;
  allComplete: string;
  limitReached: string;
  resets: string;
  compact: string;
  tokPerMin: string;
  resetsIn: string;
  syncing: string;
  err: string;
  total: string;
  limit: string;
  warn: string;
}

const LABELS: Record<Locale, Labels> = {
  en: {
    context: 'Context',
    usage: 'Usage',
    tools: 'Tools',
    agents: 'Agents',
    todos: 'Todos',
    allComplete: 'All todos complete',
    limitReached: 'Limit reached',
    resets: 'resets in',
    compact: 'compact',
    tokPerMin: 'tok/m',
    resetsIn: 'resets in',
    syncing: 'syncing...',
    err: 'err',
    total: 'total',
    limit: 'limit',
    warn: 'Warning',
  },
  zh: {
    context: '上下文',
    usage: '用量',
    tools: '工具',
    agents: '代理',
    todos: '任務',
    allComplete: '全部完成',
    limitReached: '已達上限',
    resets: '重置於',
    compact: '壓縮',
    tokPerMin: 'tok/m',
    resetsIn: '重置於',
    syncing: '同步中...',
    err: '錯誤',
    total: '總計',
    limit: '上限',
    warn: '警告',
  },
  ja: {
    context: 'コンテキスト',
    usage: '使用量',
    tools: 'ツール',
    agents: 'エージェント',
    todos: 'タスク',
    allComplete: '全タスク完了',
    limitReached: '制限到達',
    resets: 'リセット',
    compact: 'コンパクト',
    tokPerMin: 'tok/m',
    resetsIn: 'リセット',
    syncing: '同期中...',
    err: 'エラー',
    total: '合計',
    limit: '制限',
    warn: '警告',
  },
};

export function getLabels(locale: Locale): Labels {
  return LABELS[locale] || LABELS.en;
}

export function detectLocale(): Locale {
  const lang = process.env.LANG || process.env.LC_ALL || process.env.LANGUAGE || '';
  if (lang.startsWith('zh')) return 'zh';
  if (lang.startsWith('ja')) return 'ja';
  return 'en';
}
