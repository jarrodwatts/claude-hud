import type { RenderContext, SkillEntry } from '../types.js';
import { yellow, green, cyan, label } from './colors.js';

export function renderSkillsLine(ctx: RenderContext): string | null {
  const { skills } = ctx.transcript;
  const colors = ctx.config?.colors;
  const skillDetail = ctx.config?.display?.skillDetail ?? 'name';

  if (!skills || skills.length === 0) {
    return null;
  }

  const parts: string[] = [];

  const runningSkills = skills.filter((s) => s.status === 'running');
  const completedSkills = skills.filter((s) => s.status === 'completed');

  // Show running skills (up to 2)
  for (const skill of runningSkills.slice(-2)) {
    parts.push(formatSkill(skill, colors, skillDetail, 'running'));
  }

  // Count completed skills by name
  const skillCounts = new Map<string, number>();
  for (const skill of completedSkills) {
    const count = skillCounts.get(skill.name) ?? 0;
    skillCounts.set(skill.name, count + 1);
  }

  // Show top completed skills (up to 4)
  // Group by name but keep original entries to preserve timing
  const skillByName = new Map<string, SkillEntry>();
  for (const skill of completedSkills) {
    // Keep the one with latest endTime for each unique name
    const existing = skillByName.get(skill.name);
    if (!existing || (skill.endTime && existing.endTime && skill.endTime > existing.endTime)) {
      skillByName.set(skill.name, skill);
    }
  }

  const sortedSkills = Array.from(skillByName.values())
    .sort((a, b) => {
      // Prefer running, then by endTime
      if (a.status === 'running') return -1;
      if (b.status === 'running') return 1;
      const aEnd = a.endTime?.getTime() ?? 0;
      const bEnd = b.endTime?.getTime() ?? 0;
      return bEnd - aEnd;
    })
    .slice(0, 4);

  for (const skill of sortedSkills) {
    const count = skillCounts.get(skill.name) ?? 1;
    parts.push(formatSkill(skill, colors, skillDetail, 'completed', count > 1 ? count : undefined));
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join(' | ');
}

function formatSkill(
  skill: SkillEntry,
  colors?: RenderContext['config']['colors'],
  skillDetail: 'minimal' | 'name' = 'name',
  status?: 'running' | 'completed',
  count?: number
): string {
  const skillStatus = status ?? skill.status;
  const statusIcon = skillStatus === 'running' ? yellow('◐') : green('✓');
  const skillName = skillDetail === 'minimal' ? 'Skill' : skill.name;
  const coloredName = cyan(skillName);

  if (skillStatus === 'running') {
    const elapsed = formatElapsed(skill);
    return `${statusIcon} ${coloredName} ${label(`(${elapsed})`, colors)}`;
  }

  // Completed skills - show time if available
  if (skill.endTime) {
    const elapsed = formatElapsed(skill);
    if (count && count > 1) {
      return `${statusIcon} ${coloredName} ${label(`(${elapsed})`, colors)} ${label(`×${count}`, colors)}`;
    }
    return `${statusIcon} ${coloredName} ${label(`(${elapsed})`, colors)}`;
  }
  // No endTime available
  if (count && count > 1) {
    return `${statusIcon} ${coloredName} ${label(`×${count}`, colors)}`;
  }
  return `${statusIcon} ${coloredName}`;
}

function formatElapsed(skill: SkillEntry): string {
  const now = Date.now();
  const start = skill.startTime.getTime();
  const end = skill.endTime?.getTime() ?? now;
  const ms = end - start;

  if (ms < 1000) return '<1s';
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;

  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}
