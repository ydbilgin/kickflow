const TWO_DIGIT_WIDTH = 2;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;

const padTwoDigits = (value: number): string =>
  String(value).padStart(TWO_DIGIT_WIDTH, '0');

/** Formats an absolute replay message timestamp as its position inside the VOD.
 * Total hours deliberately do not wrap at 24. */
export function formatVodReplayTimestamp(
  createdAt: string,
  vodStartTimeMs: number,
): string {
  const messageTimeMs = Date.parse(createdAt);
  if (!Number.isFinite(messageTimeMs) || !Number.isFinite(vodStartTimeMs)) return '';
  const elapsedMs = messageTimeMs - vodStartTimeMs;
  if (elapsedMs < 0) return '';

  const elapsedSeconds = Math.floor(elapsedMs / 1_000);
  const hours = Math.floor(elapsedSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor(
    (elapsedSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE,
  );
  const seconds = elapsedSeconds % SECONDS_PER_MINUTE;
  return `${padTwoDigits(hours)}:${padTwoDigits(minutes)}:${padTwoDigits(seconds)}`;
}
