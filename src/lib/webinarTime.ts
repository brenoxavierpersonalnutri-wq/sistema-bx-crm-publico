// Webinar test schedule: starts at every full hour (HH:00) São Paulo time
// TEST MODE: 10 minutes per session, hourly. Switch to fixed 19:30 in production.
export const WEBINAR_DURATION_MINUTES = 10;

const SP_TZ = "America/Sao_Paulo";

/** "Now" with São Paulo wall-clock fields. */
function getSaoPauloNow(): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return new Date(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
    0,
  );
}

export function getSaoPauloNowDate(): Date {
  return getSaoPauloNow();
}

/** Start of the current hour (HH:00) in SP. */
export function getWebinarStartCurrent(): Date {
  const sp = getSaoPauloNow();
  const start = new Date(sp);
  start.setMinutes(0, 0, 0);
  return start;
}

/** Next webinar = next full hour, OR the current one if we're past its end. */
export function getNextWebinarTime(): Date {
  const sp = getSaoPauloNow();
  const currentStart = getWebinarStartCurrent();
  const currentEnd = new Date(currentStart.getTime() + WEBINAR_DURATION_MINUTES * 60_000);

  if (sp.getTime() < currentStart.getTime()) return currentStart;
  if (sp.getTime() < currentEnd.getTime()) return currentStart; // live now
  // past end → next hour
  const next = new Date(currentStart);
  next.setHours(next.getHours() + 1);
  return next;
}

/** Seconds since the current hour's HH:00. 0 if before, capped at duration. */
export function getVideoOffsetSeconds(): number {
  const sp = getSaoPauloNow();
  const start = getWebinarStartCurrent();
  const diff = Math.floor((sp.getTime() - start.getTime()) / 1000);
  if (diff < 0) return 0;
  return Math.min(diff, WEBINAR_DURATION_MINUTES * 60);
}

export function getSecondsUntilNextWebinar(): number {
  const sp = getSaoPauloNow();
  const next = getNextWebinarTime();
  return Math.max(0, Math.floor((next.getTime() - sp.getTime()) / 1000));
}

export function isWebinarLive(): boolean {
  const sp = getSaoPauloNow();
  const start = getWebinarStartCurrent();
  const end = new Date(start.getTime() + WEBINAR_DURATION_MINUTES * 60_000);
  return sp.getTime() >= start.getTime() && sp.getTime() < end.getTime();
}

export function isWebinarOver(): boolean {
  // In hourly test mode there's always a "next" within the hour, so "over" means
  // we're past this hour's session but before the next one.
  const sp = getSaoPauloNow();
  const start = getWebinarStartCurrent();
  const end = new Date(start.getTime() + WEBINAR_DURATION_MINUTES * 60_000);
  return sp.getTime() >= end.getTime();
}

export function formatHMS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
