// Where today's water should be by now, if it were spread evenly over the
// waking day. Pure, so it is tested with any clock.
//
// The day is taken as 8 AM to 8 PM. Before 8 nothing is expected yet; from
// 8 PM the whole goal is.

export const PACE_START_HOUR = 8;
export const PACE_END_HOUR = 20;

/** Whole glasses expected by `now`. */
export function glassesExpected(goal: number, now: Date): number {
  const hour = now.getHours() + now.getMinutes() / 60;
  const share = Math.min(1, Math.max(0, (hour - PACE_START_HOUR) / (PACE_END_HOUR - PACE_START_HOUR)));
  return Math.floor(goal * share);
}

/**
 * A few words on the pace, or null when there is nothing worth saying:
 * the goal is met, or it is too early in the day for a pace to mean much.
 */
export function paceWords(water: number, goal: number, now: Date): string | null {
  if (water >= goal) return null;
  const expected = glassesExpected(goal, now);
  if (expected === 0) return null;
  const behind = expected - water;
  if (behind <= 0) return 'on pace';
  return `${behind} behind pace`;
}
