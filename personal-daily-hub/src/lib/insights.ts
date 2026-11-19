// Patterns in the person's own logs, for the Insights card. Pure.
//
// Each insight compares two groups of days (more sleep and less, a habit
// done and not done) and is shown only when both groups have enough days
// and the difference is big enough to be worth a sentence. The wording is
// descriptive ("on days you…"), never causal: these are a few weeks of one
// person's notes, not a study.

import { isScheduled, hasAnyData, type DayLog, type Habit } from './store';

/** Days each side of a comparison needs before anything is said. */
export const MIN_DAYS = 4;
export const INSIGHTS_MAX = 4;
const GOOD_SLEEP = 7;
const WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

export type Insight =
  | { kind: 'sleep-energy'; strength: number; more: number; less: number }
  | { kind: 'sleep-mood'; strength: number; more: number; less: number }
  | { kind: 'habit-mood'; strength: number; habit: string; done: number; skipped: number }
  | { kind: 'water-energy'; strength: number; reached: number; short: number }
  | { kind: 'spend-weekday'; strength: number; weekday: number; thatDay: number; otherDays: number };

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Two groups' means, or null when either is too small or the gap too narrow. */
function compare(a: number[], b: number[], minGap: number): { a: number; b: number } | null {
  if (a.length < MIN_DAYS || b.length < MIN_DAYS) return null;
  const ma = mean(a);
  const mb = mean(b);
  return Math.abs(ma - mb) >= minGap ? { a: ma, b: mb } : null;
}

const weekday = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
};

/** The strongest few patterns, strongest first. Strength is the gap as a share of the scale. */
export function findInsights(days: Record<string, DayLog>, habits: Habit[], waterGoal: number): Insight[] {
  const entries = Object.entries(days);
  const out: Insight[] = [];

  // Sleep the night before, against the day's energy and mood.
  const slept = entries.filter(([, d]) => d.sleep !== null);
  const energyBySleep = (good: boolean) =>
    slept.filter(([, d]) => d.energy !== null && (d.sleep! >= GOOD_SLEEP) === good).map(([, d]) => d.energy!);
  const se = compare(energyBySleep(true), energyBySleep(false), 0.5);
  if (se) out.push({ kind: 'sleep-energy', strength: Math.abs(se.a - se.b) / 9, more: se.a, less: se.b });

  const moodBySleep = (good: boolean) =>
    slept.filter(([, d]) => d.mood !== null && (d.sleep! >= GOOD_SLEEP) === good).map(([, d]) => d.mood!);
  const sm = compare(moodBySleep(true), moodBySleep(false), 0.3);
  if (sm) out.push({ kind: 'sleep-mood', strength: Math.abs(sm.a - sm.b) / 4, more: sm.a, less: sm.b });

  // Each habit, on the days it was meant for: mood when done and when not.
  // Only the clearest one is kept, and only when the mood was higher.
  let best: Insight | null = null;
  for (const h of habits) {
    const due = entries.filter(([date, d]) => d.mood !== null && isScheduled(h, date));
    const c = compare(
      due.filter(([, d]) => d.habitsDone.includes(h.id)).map(([, d]) => d.mood!),
      due.filter(([, d]) => !d.habitsDone.includes(h.id)).map(([, d]) => d.mood!),
      0.3,
    );
    if (!c || c.a <= c.b) continue;
    const strength = (c.a - c.b) / 4;
    if (!best || strength > best.strength) best = { kind: 'habit-mood', strength, habit: h.label, done: c.a, skipped: c.b };
  }
  if (best) out.push(best);

  // Water goal reached, against energy.
  const energyDays = entries.filter(([, d]) => d.energy !== null && d.water > 0);
  const we = compare(
    energyDays.filter(([, d]) => d.water >= waterGoal).map(([, d]) => d.energy!),
    energyDays.filter(([, d]) => d.water < waterGoal).map(([, d]) => d.energy!),
    0.5,
  );
  if (we) out.push({ kind: 'water-energy', strength: Math.abs(we.a - we.b) / 9, reached: we.a, short: we.b });

  // The weekday with the most spending, over days the app was used.
  const used = entries.filter(([, d]) => hasAnyData(d));
  const spent = (d: DayLog) => d.expenses.reduce((n, e) => n + e.cents, 0);
  let top: { weekday: number; avg: number; others: number } | null = null;
  for (let w = 0; w < 7; w++) {
    const on = used.filter(([date]) => weekday(date) === w).map(([, d]) => spent(d));
    const off = used.filter(([date]) => weekday(date) !== w).map(([, d]) => spent(d));
    if (on.length < 2 || off.length < MIN_DAYS) continue;
    const avg = mean(on);
    const others = mean(off);
    if (avg > 0 && avg >= others * 1.5 && (!top || avg > top.avg)) top = { weekday: w, avg, others };
  }
  if (top) {
    out.push({
      kind: 'spend-weekday',
      strength: Math.min(1, (top.avg - top.others) / Math.max(top.avg, 1)) / 2,
      weekday: top.weekday,
      thatDay: Math.round(top.avg),
      otherDays: Math.round(top.others),
    });
  }

  return out.sort((a, b) => b.strength - a.strength).slice(0, INSIGHTS_MAX);
}

/** The sentence for an insight. Money goes through `money`, so "Hide amounts" applies. */
export function describeInsight(i: Insight, money: (cents: number) => string): string {
  const n = (x: number) => x.toFixed(1);
  switch (i.kind) {
    case 'sleep-energy':
      return `After 7 or more hours of sleep, your energy averaged ${n(i.more)} out of 10, against ${n(i.less)} after less.`;
    case 'sleep-mood':
      return `After 7 or more hours of sleep, your mood averaged ${n(i.more)} out of 5, against ${n(i.less)} after less.`;
    case 'habit-mood':
      return `On days you did “${i.habit}”, your mood averaged ${n(i.done)} out of 5, against ${n(i.skipped)} when you didn’t.`;
    case 'water-energy':
      return `On days you reached your water goal, your energy averaged ${n(i.reached)} out of 10, against ${n(i.short)} when you didn’t.`;
    case 'spend-weekday':
      return `You spend the most on ${WEEKDAYS[i.weekday]}: ${money(i.thatDay)} on average, against ${money(i.otherDays)} on other days.`;
  }
}
