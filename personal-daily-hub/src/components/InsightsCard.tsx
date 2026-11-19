import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Lightbulb, Lock } from '../icons';
import { describeInsight, type Insight } from '../lib/insights';
import { colors, radius, space, tint, type } from '../theme';
import { Card } from './Card';
import { useMoney } from './Money';

type Props = {
  isPremium: boolean;
  insights: Insight[];
  onUnlock: () => void;
};

/** A few patterns from the person's own logs (Premium). */
export function InsightsCard({ isPremium, insights, onUnlock }: Props) {
  const { money } = useMoney();
  return (
    <Card
      icon={Lightbulb}
      accent={colors.insights}
      title="Insights"
      subtitle={isPremium ? 'Patterns in your last 60 days' : 'What your sleep, habits and spending have in common'}
      testID="card-insights"
    >
      {!isPremium ? (
        <Pressable
          onPress={onUnlock}
          accessibilityRole="button"
          accessibilityLabel="Unlock insights with Premium"
          style={({ pressed }) => [styles.locked, pressed && { opacity: 0.8 }]}
          testID="insights-unlock"
        >
          <View style={styles.ghost} pointerEvents="none">
            {[0.9, 0.7, 0.8].map((w, i) => (
              <View key={i} style={[styles.ghostLine, { width: `${w * 100}%` }]} />
            ))}
          </View>
          <View style={styles.lockBadge}>
            <Lock size={14} color={colors.onPremium} strokeWidth={2.75} />
            <Text style={styles.lockText}>Unlock with Premium</Text>
          </View>
        </Pressable>
      ) : insights.length === 0 ? (
        <Text style={styles.empty} testID="insights-empty">
          Keep logging sleep, energy and mood. Patterns show up here after a couple of weeks.
        </Text>
      ) : (
        <View style={styles.list}>
          {insights.map((i) => (
            <View key={i.kind} style={styles.item} testID={`insight-${i.kind}`}>
              <View style={styles.dot} />
              <Text style={styles.text}>{describeInsight(i, money)}</Text>
            </View>
          ))}
          <Text style={styles.note}>Patterns in your own logs, not proof of cause, and not medical advice.</Text>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.md },
  item: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 8, backgroundColor: colors.insights },
  text: { ...type.body, color: colors.text, flex: 1, lineHeight: 22 },
  note: { ...type.caption, color: colors.textMuted },
  empty: { ...type.body, color: colors.textMuted },
  locked: {
    height: 104,
    borderRadius: radius.md,
    backgroundColor: colors.cardRaised,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghost: { ...StyleSheet.absoluteFill, padding: space.lg, gap: space.md },
  ghostLine: { height: 10, borderRadius: 5, backgroundColor: tint(colors.insights, 0.16) },
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
