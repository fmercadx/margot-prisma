// One day as plain text, for the share sheet. Pure.
//
// Only what the person chose to log, in their own words. Money goes
// through `money`, so "Hide amounts" applies here too.

import { CATEGORY_LABELS } from './categories';
import { clockTime, longDate, parseDateKey, weekdayName } from './date';
import { moodWord } from './mood';
import { ENERGY_MAX, expenseName, focusLabel, isDue, totalCents, type DayLog, type Habit } from './store';

const sleepText = (h: number) => `${Math.floor(h)}${h % 1 ? '½' : ''} h`;

export function dayAsText(
  date: string,
  day: DayLog,
  habits: Habit[],
  waterGoal: number,
  money: (cents: number) => string,
): string {
  const d = parseDateKey(date);
  const lines = [`${weekdayName(d)}, ${longDate(d)}`];

  if (day.focus) lines.push(`Focus: ${day.focus}`);
  if (day.focusMinutes > 0) lines.push(`Focused for ${focusLabel(day.focusMinutes)}`);

  const due = habits.filter((h) => isDue(h, date, day));
  const done = habits.filter((h) => day.habitsDone.includes(h.id));
  if (done.length) {
    const doneDue = due.filter((h) => day.habitsDone.includes(h.id)).length;
    lines.push(`Habits ${doneDue}/${due.length}: ${done.map((h) => h.label).join(', ')}`);
  }
  const skipped = habits.filter((h) => day.habitsSkipped.includes(h.id));
  if (skipped.length) lines.push(`Skipped: ${skipped.map((h) => h.label).join(', ')}`);

  const body = [
    day.water > 0 ? `Water ${day.water}/${waterGoal}` : '',
    day.sleep !== null ? `Sleep ${sleepText(day.sleep)}` : '',
    day.energy !== null ? `Energy ${day.energy}/${ENERGY_MAX}` : '',
    day.mood !== null ? `Mood ${moodWord(day.mood)}` : '',
  ].filter(Boolean);
  if (body.length) lines.push(body.join(' · '));

  if (day.expenses.length) {
    lines.push(`Spent ${money(totalCents(day))}`);
    for (const e of [...day.expenses].reverse()) {
      lines.push(`  ${expenseName(e)} (${CATEGORY_LABELS[e.category]}) ${money(e.cents)}`);
    }
  }

  if (day.notes.length) {
    lines.push('Notes');
    for (const n of [...day.notes].reverse()) {
      const box = !n.task ? '•' : n.doneAt !== undefined ? '[x]' : n.carriedTo ? '[→]' : '[ ]';
      lines.push(`  ${box} ${n.text} (${clockTime(n.createdAt)})`);
    }
  }

  if (day.gratitude.length) lines.push('Three good things', ...day.gratitude.map((g, i) => `  ${i + 1}. ${g}`));

  if (day.journal) lines.push('Journal', ...day.journal.split('\n').map((l) => `  ${l}`));

  if (lines.length === 1) lines.push('Nothing logged.');
  return lines.join('\n');
}
