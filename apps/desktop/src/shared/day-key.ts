// A calendar day on this Mac as text, "2026-11-20": the key the daily totals are kept under, read
// the same way by the main process (writing them) and the screens (showing them).

const pad = (value: number) => String(value).padStart(2, "0");

export function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The start of that day on this Mac. */
export function dayKeyStart(key: string): number {
  const [year = 1970, month = 1, day = 1] = key.split("-").map(Number);
  return new Date(year, month - 1, day).getTime();
}
