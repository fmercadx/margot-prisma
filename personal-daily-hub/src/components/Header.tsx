import { Bell, BellRing, CalendarDays, ChevronLeft, ChevronRight, Clock, Crown, Settings } from '../icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useClock } from '../hooks/useClock';
import { clockTime, greeting, longDate, weekdayName } from '../lib/date';
import { hourLabel } from '../lib/reminders';
import { colors, radius, space, tint, type } from '../theme';
import { IconButton } from './IconButton';

type Props = {
  isPremium: boolean;
  onPremiumPress: () => void;
  reminder: { supported: boolean; on: boolean; busy: boolean; hour: number; onToggle: () => void };
  onSettingsPress: () => void;
  message: string | null;
  /** Which day is being logged, and stepping between today and the past week. */
  logging: {
    label: string; // "Today", "Yesterday", "Tuesday", "Last Thursday"
    fullDate: string;
    isToday: boolean;
    canBack: boolean;
    onBack: () => void;
    onForward: () => void;
    onToday: () => void;
  };
};

export function Header({ isPremium, onPremiumPress, reminder, onSettingsPress, message, logging }: Props) {
  const now = useClock();

  return (
    <View style={styles.wrap}>
      <View style={styles.topRow}>
        <Text style={styles.greeting}>{greeting(now)}</Text>
        <View style={styles.actions}>
          <Pressable
            onPress={onPremiumPress}
            disabled={isPremium}
            accessibilityRole={isPremium ? 'text' : 'button'}
            accessibilityLabel={isPremium ? 'Premium is active' : 'Go Premium'}
            style={({ pressed }) => [styles.badge, pressed && { opacity: 0.7 }]}
            testID="premium-badge"
          >
            <Crown size={14} color={colors.premium} strokeWidth={2.5} />
            <Text style={styles.badgeText}>{isPremium ? 'Premium' : 'Go Premium'}</Text>
          </Pressable>
          {reminder.supported ? (
            <IconButton
              icon={reminder.on ? BellRing : Bell}
              label={
                reminder.on
                  ? `Turn off the ${hourLabel(reminder.hour)} daily reminder`
                  : `Turn on the ${hourLabel(reminder.hour)} daily reminder`
              }
              onPress={reminder.onToggle}
              disabled={reminder.busy}
              color={reminder.on ? colors.premium : colors.textSecondary}
              filled
            />
          ) : null}
          <IconButton icon={Settings} label="Settings" onPress={onSettingsPress} filled testID="open-settings" />
        </View>
      </View>

      <Text style={styles.day} accessibilityRole="header">
        {weekdayName(now)}
      </Text>

      <View style={styles.metaRow}>
        <View style={styles.meta}>
          <CalendarDays size={15} color={colors.textSecondary} />
          <Text style={styles.metaText}>{longDate(now)}</Text>
        </View>
        <View style={styles.meta}>
          <Clock size={15} color={colors.textSecondary} />
          <Text style={styles.metaText} testID="header-time">
            {clockTime(now)}
          </Text>
        </View>
      </View>

      <View
        style={[styles.dayBar, !logging.isToday && styles.dayBarPast]}
        accessibilityRole="toolbar"
        accessibilityLabel={logging.isToday ? 'Logging today' : `Logging ${logging.fullDate}`}
        testID="day-bar"
      >
        <IconButton
          icon={ChevronLeft}
          size={16}
          label="Log the day before"
          onPress={logging.onBack}
          disabled={!logging.canBack}
          color={logging.isToday ? colors.textSecondary : colors.premium}
        />
        <View style={styles.dayBarText}>
          <Text style={[styles.dayBarLabel, !logging.isToday && { color: colors.premium }]} testID="logging-day">
            {logging.isToday ? 'Logging today' : `Logging ${logging.label}`}
          </Text>
          {!logging.isToday ? <Text style={styles.dayBarDate}>{logging.fullDate}</Text> : null}
        </View>
        {logging.isToday ? null : (
          <>
            <IconButton icon={ChevronRight} size={16} label="Log the day after" onPress={logging.onForward} color={colors.premium} />
            <Pressable
              onPress={logging.onToday}
              accessibilityRole="button"
              accessibilityLabel="Back to today"
              hitSlop={8}
              style={({ pressed }) => [styles.todayButton, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.todayText}>Today</Text>
            </Pressable>
          </>
        )}
      </View>

      {message ? (
        <Text style={styles.message} accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs, paddingTop: space.sm, paddingBottom: space.sm },
  dayBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginTop: space.sm,
    paddingRight: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  dayBarPast: { backgroundColor: tint(colors.premium, 0.1), borderColor: colors.premium },
  dayBarText: { flex: 1, gap: 1 },
  dayBarLabel: { ...type.label, color: colors.textSecondary, fontWeight: '600' },
  dayBarDate: { ...type.caption, color: colors.textSecondary },
  todayButton: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.premium,
  },
  todayText: { ...type.label, color: colors.onPremium, fontWeight: '700' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  greeting: { ...type.label, color: colors.textSecondary, letterSpacing: 0.2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    minHeight: 32,
    borderRadius: radius.pill,
    backgroundColor: tint(colors.premium, 0.12),
  },
  badgeText: { ...type.label, color: colors.premium, fontWeight: '600' },
  day: { ...type.hero, color: colors.text },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg, rowGap: space.xs },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { ...type.body, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  message: {
    ...type.caption,
    color: colors.text,
    backgroundColor: colors.cardRaised,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    marginTop: space.sm,
    alignSelf: 'flex-start',
    overflow: 'hidden',
  },
});
