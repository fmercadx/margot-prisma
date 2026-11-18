import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ChevronLeft, ChevronRight } from '../icons';
import { dateKey, longDate, monthTitle, parseDateKey } from '../lib/date';
import { hasAnyData, type DayLog } from '../lib/store';
import { colors, radius, space, tint, type } from '../theme';
import { IconButton } from './IconButton';

type Props = {
  days: Record<string, DayLog>;
  habitIds: string[];
  today: string;
  /** The oldest day in memory; earlier days can't be opened. */
  firstLoaded: string;
  onOpenDay: (date: string) => void;
};

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * A sequential scale in one hue: the habits green, stepping up from the
 * card toward full strength. Level 0 is "none done" and recedes into the
 * surface; the top level is every habit done.
 */
const LEVEL_FILL = [colors.cardRaised, tint(colors.habits, 0.25), tint(colors.habits, 0.45), tint(colors.habits, 0.7), colors.habits];
// Day numbers stay in text ink; on the two strongest steps that ink is dark.
const LEVEL_INK = [colors.text, colors.text, colors.text, colors.background, colors.background];

/** 0 = none done … 4 = all done. */
export function habitLevel(done: number, total: number): number {
  if (total <= 0 || done <= 0) return 0;
  if (done >= total) return 4;
  const share = done / total;
  return share <= 1 / 3 ? 1 : share <= 2 / 3 ? 2 : 3;
}

/**
 * One month, each day shaded by how many habits were done. Tap a day to
 * see everything from it. Steps back through the months the app has loaded.
 */
export function MonthCalendar({ days, habitIds, today, firstLoaded, onOpenDay }: Props) {
  const [offset, setOffset] = useState(0); // 0 = this month, -1 = last month…
  useEffect(() => setOffset(0), [today]);

  const t = parseDateKey(today);
  const first = new Date(t.getFullYear(), t.getMonth() + offset, 1);
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const lastOfPrev = dateKey(new Date(first.getFullYear(), first.getMonth(), 0));
  const canPrev = lastOfPrev >= firstLoaded;
  const canNext = offset < 0;

  const cells: (string | null)[] = [
    ...Array<null>(first.getDay()).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) =>
      dateKey(new Date(first.getFullYear(), first.getMonth(), i + 1)),
    ),
  ];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));

  return (
    <View style={styles.wrap} testID="month-calendar">
      <View style={styles.head}>
        <IconButton icon={ChevronLeft} label="Previous month" onPress={() => setOffset(offset - 1)} disabled={!canPrev} size={18} />
        <Text style={styles.title} accessibilityRole="header" testID="month-title">
          {monthTitle(first)}
        </Text>
        <IconButton icon={ChevronRight} label="Next month" onPress={() => setOffset(offset + 1)} disabled={!canNext} size={18} />
      </View>

      <View style={styles.row} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {WEEKDAYS.map((d, i) => (
          <Text key={i} style={styles.weekday}>
            {d}
          </Text>
        ))}
      </View>

      {weeks.map((week, w) => (
        <View key={w} style={styles.row}>
          {week.map((key, i) => {
            if (key === null) return <View key={i} style={styles.cell} />;
            const n = Number(key.slice(8));
            const future = key > today;
            const openable = !future && key >= firstLoaded;
            const log = days[key];
            const done = log ? habitIds.filter((id) => log.habitsDone.includes(id)).length : 0;
            const level = habitLevel(done, habitIds.length);
            const isToday = key === today;
            const what = !openable
              ? future
                ? 'still to come'
                : 'not loaded'
              : done > 0
                ? `${done} of ${habitIds.length} habits done`
                : log && hasAnyData(log)
                  ? 'no habits done'
                  : 'nothing logged';
            return (
              <Pressable
                key={key}
                onPress={() => onOpenDay(key)}
                disabled={!openable}
                accessibilityRole="button"
                accessibilityState={{ disabled: !openable }}
                accessibilityLabel={`${isToday ? 'Today, ' : ''}${longDate(parseDateKey(key))}: ${what}`}
                style={({ pressed }) => [
                  styles.cell,
                  styles.day,
                  { backgroundColor: openable ? LEVEL_FILL[level] : 'transparent' },
                  isToday && styles.today,
                  pressed && { opacity: 0.7 },
                ]}
                testID={`cal-${key}`}
              >
                <Text style={[styles.num, { color: openable ? LEVEL_INK[level] : colors.textMuted }]}>{n}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}

      <View style={styles.legend} accessible accessibilityLabel="Shading shows how many habits were done each day, from none to all">
        <Text style={styles.legendText}>Habits done each day</Text>
        <View style={styles.scale}>
          <Text style={styles.legendText}>None</Text>
          {LEVEL_FILL.map((c, i) => (
            <View key={i} style={[styles.swatch, { backgroundColor: c }]} />
          ))}
          <Text style={styles.legendText}>All</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.xs },
  title: { ...type.label, color: colors.text, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 4 },
  weekday: { flex: 1, textAlign: 'center', ...type.caption, color: colors.textMuted },
  cell: { flex: 1, aspectRatio: 1, maxHeight: 56 },
  day: { borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  today: { borderWidth: 2, borderColor: colors.text },
  num: { ...type.caption, fontWeight: '600', fontVariant: ['tabular-nums'] },
  legend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  legendText: { ...type.caption, color: colors.textSecondary },
  scale: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  swatch: { width: 12, height: 12, borderRadius: 3 },
});
