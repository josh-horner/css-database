export const WINDOWS: Record<string, { label: string; start: string; end: string }> = {
  AM: { label: "9:30 AM – 12:30 PM", start: "09:30", end: "12:30" },
  PM: { label: "1:30 – 4:30 PM", start: "13:30", end: "16:30" },
  ALL: { label: "9:30 AM – 4:30 PM", start: "09:30", end: "16:30" },
};

export function windowLabel(windowId: string | null): string {
  return windowId ? (WINDOWS[windowId]?.label ?? windowId) : "Any time that day";
}

export function localDate(timeZone: string, at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(at);
}

export function localTime(timeZone: string, at: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(at);
}
