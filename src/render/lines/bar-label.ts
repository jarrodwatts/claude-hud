import { t } from "../../i18n/index.js";

/**
 * Returns the max visual width among the bar labels (Context, Usage, Weekly)
 * so progress bars can be aligned when they wrap to separate lines.
 */
export function getMaxBarLabelWidth(): number {
  const labels = [
    t("label.context"),
    t("label.usage"),
    t("label.weekly"),
  ];
  return Math.max(...labels.map((l) => l.length));
}

export function padBarLabel(text: string): string {
  return text.padEnd(getMaxBarLabelWidth());
}
