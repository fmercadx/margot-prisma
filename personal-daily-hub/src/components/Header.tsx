import { Bell, BellRing, CalendarDays, Clock, Crown } from '../icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useClock } from '../hooks/useClock';
import { clockTime, greeting, longDate, weekdayName } from '../lib/date';
import { colors, radius, space, tint, type } from '../theme';
import { IconButton } from './IconButton';

type Props = {
  isPremium: boolean;
  onPremiumPress: () => void;
  reminder: { supported: boolean; on: boolean; busy: boolean; onToggle: () => void };
  message: string | null;
};

export function Header({ isPremium, onPremiumPress, reminder, message }: Props) {
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
              label={reminder.on ? 'Turn off the 8 PM daily reminder' : 'Turn on an 8 PM daily reminder'}
              onPress={reminder.onToggle}
              disabled={reminder.busy}
              color={reminder.on ? colors.premium : colors.textSecondary}
              filled
            />
          ) : null}
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
