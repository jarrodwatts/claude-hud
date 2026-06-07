import type { RenderContext } from "../types.js";
import { cyan, label } from "./colors.js";
import { t } from "../i18n/index.js";

const MAX_SKILLS_SHOWN = 5;

export function renderSkillsLine(ctx: RenderContext): string | null {
  const { skills } = ctx.transcript;
  const colors = ctx.config?.colors;

  if (!skills || skills.length === 0) {
    return null;
  }

  const shown = skills.slice(0, MAX_SKILLS_SHOWN);
  const remaining = skills.length - shown.length;

  const names = shown.map((skill) => cyan(skill)).join(label(", ", colors));
  const more = remaining > 0 ? label(` +${remaining} more`, colors) : "";

  return `${cyan("⚡")} ${label(`${t("label.skills")}:`, colors)} ${names}${more}`;
}
