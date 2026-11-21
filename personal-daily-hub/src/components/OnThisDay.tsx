import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ChevronRight, History, Sparkles, Target } from '../icons';
import { longDate, parseDateKey, weekdayName } from '../lib/date';
import type { Memory } from '../lib/onThisDay';
import { colors, radius, space, type } from '../theme';
import { Card } from './Card';

type Props = {
  memories: Memory[];
  /** Opens a day that is in memory; absent for one that isn't (a year ago). */
  canOpen: (date: string) => boolean;
  onOpen: (date: string) => void;
};

/** What you wrote a week, a month and a year ago. Shows nothing when there is nothing to show. */
export function OnThisDay({ memories, canOpen, onOpen }: Props) {
  if (memories.length === 0) return null;
  return (
    <Card
      icon={History}
      accent={colors.history}
      title="On this day"
      subtitle="What you wrote back then"
      testID="card-on-this-day"
    >
      <View style={styles.list}>
        {memories.map((m) => {
          const d = parseDateKey(m.date);
          const openable = canOpen(m.date);
          const body = (
            <>
              <View style={styles.head}>
                <Text style={styles.when}>{m.label}</Text>
                <Text style={styles.date}>
                  {weekdayName(d)}, {longDate(d)}
                </Text>
                {openable ? <ChevronRight size={16} color={colors.textMuted} style={styles.chevron} /> : null}
              </View>
              {m.focus ? (
                <View style={styles.line}>
                  <Target size={14} color={colors.focus} strokeWidth={2.25} />
                  <Text style={styles.text}>{m.focus}</Text>
                </View>
              ) : null}
              {m.good.length > 0 ? (
                <View style={styles.line}>
                  <Sparkles size={14} color={colors.journal} strokeWidth={2.25} />
                  <Text style={styles.text}>{m.good.join(' · ')}</Text>
                </View>
              ) : null}
              {m.journal ? (
                <Text style={[styles.text, styles.quote]} numberOfLines={2}>
                  “{m.journal}”
                </Text>
              ) : null}
              {m.note ? (
                <Text style={[styles.text, styles.quote]} numberOfLines={2}>
                  {m.note}
                </Text>
              ) : null}
            </>
          );
          return openable ? (
            <Pressable
              key={m.date}
              onPress={() => onOpen(m.date)}
              accessibilityRole="button"
              accessibilityLabel={`${m.label}: see ${weekdayName(d)}, ${longDate(d)}`}
              style={({ pressed }) => [styles.memory, pressed && { opacity: 0.7 }]}
              testID={`memory-${m.date}`}
            >
              {body}
            </Pressable>
          ) : (
            <View key={m.date} style={styles.memory} testID={`memory-${m.date}`}>
              {body}
            </View>
          );
        })}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  memory: { gap: space.xs, padding: space.md, borderRadius: radius.md, backgroundColor: colors.cardRaised },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' },
  when: { ...type.label, color: colors.text, fontWeight: '700' },
  date: { ...type.caption, color: colors.textSecondary, flexShrink: 1 },
  chevron: { marginLeft: 'auto', alignSelf: 'center' },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  text: { ...type.label, fontWeight: '400', color: colors.text, flexShrink: 1, lineHeight: 19 },
  quote: { color: colors.textSecondary, fontStyle: 'italic' },
});
