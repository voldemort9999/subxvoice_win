/** Lines a model must always see: where it can type, what it can press, and where focus is. */
const ESSENTIAL = /\b(Edit|Button|ComboBox|CheckBox)\b|\(focused\)/;

/**
 * Real UI Automation trees run to thousands of elements (WhatsApp ~21,000 before the walk prunes
 * off-screen parts); sent whole they cost tokens and bury what matters (TrueForge's
 * LargeToolResponse idea, design §2). Keeps every essential line, then the lines nearest the focused
 * element, in the window's own order — "the second video" depends on that order.
 */
export function trimTree(text: string, maxChars = 6000): string {
  if (text.length <= maxChars) return text;
  const lines = text.split("\n");
  const keep = new Set<number>();
  let used = 0;
  const take = (i: number) => {
    keep.add(i);
    used += (lines[i]?.length ?? 0) + 1;
  };

  lines.forEach((line, i) => {
    if (ESSENTIAL.test(line)) take(i);
  });
  const focused = Math.max(
    0,
    lines.findIndex((line) => line.includes("(focused)")),
  );
  const rest = lines
    .map((_, i) => i)
    .filter((i) => !keep.has(i))
    .sort((a, b) => Math.abs(a - focused) - Math.abs(b - focused));
  for (const i of rest) {
    if (used + (lines[i]?.length ?? 0) + 1 > maxChars) break;
    take(i);
  }

  const kept = [...keep].sort((a, b) => a - b).map((i) => lines[i]);
  return `${kept.join("\n")}\n(${lines.length - keep.size} more elements not shown — read again with a filter)`;
}
