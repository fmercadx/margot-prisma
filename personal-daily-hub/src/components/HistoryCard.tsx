import { ChartColumnBig, Lock } from '../icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { longDate, parseDateKey, weekdayInitial, weekdayName } from '../lib/date';
import { formatCents, formatCentsCompact } from '../lib/money';
import { ENERGY_MAX, WATER_GOAL, totalCents, type DayLog } from '../lib/store';
import { colors, radius, space, tint, type } from '../theme';
import { Card } from './Card';

type Props = {
  isPremium: boolean;
  /** Oldest first; the last entry is today. A missing day is null. */
  days: { date: string; log: DayLog | null }[];
  onUnlock: () => void;
};

export function HistoryCard({ isPremium, days, onUnlock }: Props) {
  return (
    <Card
      icon={ChartColumnBig}
      accent={colors.history}
      title="Last 7 days"
      subtitle={isPremium ? 'Tap a day to see its value' : 'Trends for water, energy and spending'}
      testID="card-history"
    >
      {isPremium ? (
        <View style={styles.charts}>
          <MiniColumns
            title="Water"
            color={colors.water}
            days={days}
            value={(d) => (d && d.water > 0 ? d.water : null)}
            scaleMax={(vals) => Math.max(WATER_GOAL, ...vals)}
            format={(v) => `${v} ${v === 1 ? 'glass' : 'glasses'}`}
            short={(v) => String(v)}
          />
          <MiniColumns
            title="Energy"
            color={colors.energy}
            days={days}
            value={(d) => d?.energy ?? null}
            scaleMax={() => ENERGY_MAX}
            format={(v) => `${v} / ${ENERGY_MAX}`}
            short={(v) => String(v)}
          />
          <MiniColumns
            title="Spending"
            color={colors.expenses}
            days={days}
            value={(d) => (d && d.expenses.length > 0 ? totalCents(d) : null)}
            scaleMax={(vals) => Math.max(1, ...vals)}
            format={formatCents}
            short={formatCentsCompact}
          />
        </View>
      ) : (
        <Pressable
          onPress={onUnlock}
          accessibilityRole="button"
          accessibilityLabel="Unlock history with Premium"
          style={({ pressed }) => [styles.locked, pressed && { opacity: 0.8 }]}
          testID="history-unlock"
        >
          <View style={styles.ghost} pointerEvents="none">
            {[0.35, 0.6, 0.45, 0.8, 0.55, 0.7, 0.9].map((h, i) => (
              <View key={i} style={[styles.ghostBar, { height: `${h * 100}%` }]} />
            ))}
          </View>
          <View style={styles.lockBadge}>
            <Lock size={14} color={colors.onPremium} strokeWidth={2.75} />
            <Text style={styles.lockText}>Unlock with Premium</Text>
          </View>
        </Pressable>
      )}
    </Card>
  );
}

type ColumnsProps = {
  title: string;
  color: string;
  days: Props['days'];
  value: (log: DayLog | null) => number | null;
  scaleMax: (values: number[]) => number;
  format: (v: number) => string;
  short: (v: number) => string;
};

const PLOT_HEIGHT = 56;

/**
 * Seven columns, one per day, for a single measure. Single series, so no
 * legend: the title names it. Columns are capped at 20px wide with a 4px
 * rounded top and a square foot on a shared hairline baseline. A day with
 * nothing logged draws nothing. Values are labelled selectively — only
 * the selected day (today by default) — and tapping a column selects it.
 */
function MiniColumns({ title, color, days, value, scaleMax, format, short }: ColumnsProps) {
  const [selected, setSelected] = useState(days.length - 1);
  const values = days.map((d) => value(d.log));
  const present = values.filter((v): v is number => v !== null);
  const max = scaleMax(present);
  const sel = days[selected];
  const selValue = values[selected];
  const isToday = selected === days.length - 1;

  return (
    <View style={styles.chart}>
      <View style={styles.chartHead}>
        <View style={styles.chartTitleRow}>
          <View style={[styles.key, { backgroundColor: color }]} />
          <Text style={styles.chartTitle}>{title}</Text>
        </View>
        <Text style={styles.chartValue}>
          <Text style={styles.chartValueDay}>{isToday ? 'Today' : weekdayName(parseDateKey(sel.date))} · </Text>
          {selValue === null ? 'Nothing logged' : format(selValue)}
        </Text>
      </View>

      <View style={styles.plot}>
        {days.map((d, i) => {
          const v = values[i];
          const h = v === null ? 0 : Math.max(4, Math.round((v / max) * PLOT_HEIGHT));
          const active = i === selected;
          return (
            <Pressable
              key={d.date}
              onPress={() => setSelected(i)}
              style={styles.band}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${title}, ${longDate(parseDateKey(d.date))}: ${
                v === null ? 'nothing logged' : format(v)
              }`}
            >
              <View style={styles.barSlot}>
                {active && v !== null ? <Text style={styles.cap}>{short(v)}</Text> : null}
                {v !== null ? (
                  <View
                    style={[styles.bar, { height: h, backgroundColor: color, opacity: active ? 1 : 0.55 }]}
                  />
                ) : null}
              </View>
              <Text style={[styles.dayLabel, active && styles.dayLabelActive]}>{weekdayInitial(d.date)}</Text>
            </Pressable>
          );
        })}
        <View style={styles.baseline} pointerEvents="none" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  charts: { gap: space.xl },
  chart: { gap: space.sm },
  chartHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm },
  chartTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  key: { width: 8, height: 8, borderRadius: 2 },
  chartTitle: { ...type.label, color: colors.text },
  chartValue: { ...type.label, color: colors.text, fontVariant: ['tabular-nums'], flexShrink: 1, textAlign: 'right' },
  chartValueDay: { color: colors.textSecondary, fontWeight: '400' },
  plot: { flexDirection: 'row' },
  band: { flex: 1, alignItems: 'center', gap: 6 },
  barSlot: { height: PLOT_HEIGHT + 18, width: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  cap: { ...type.caption, color: colors.textSecondary, marginBottom: 2, fontVariant: ['tabular-nums'] },
  bar: { width: 20, maxWidth: '70%', borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  baseline: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: PLOT_HEIGHT + 18,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
  },
  dayLabel: { ...type.caption, color: colors.textMuted },
  dayLabelActive: { color: colors.text, fontWeight: '700' },
  locked: {
    height: 120,
    borderRadius: radius.md,
    backgroundColor: colors.cardRaised,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghost: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
  ghostBar: {
    width: 20,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    backgroundColor: tint(colors.history, 0.18),
  },
  lockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.premium,
  },
  lockText: { ...type.label, color: colors.onPremium, fontWeight: '700' },
});
