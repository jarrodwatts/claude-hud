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
