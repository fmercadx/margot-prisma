import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Check, Forward, Goal, Plus, X } from '../icons';
import { weekRangeLabel } from '../lib/date';
import { moodWord } from '../lib/mood';
import { GOAL_MAX_LENGTH, WEEK_GOALS_MAX, type WeekGoal } from '../lib/store';
import type { WeekReview } from '../lib/weekReview';
import { colors, HIT, inputColors, radius, space, tint, type } from '../theme';
import { Card } from './Card';
import { IconButton } from './IconButton';
import { useMoney } from './Money';

type Props = {
  /** The Sunday the week starts on. */
  week: string;
  /** False while filling in a day from last week. */
  isThisWeek: boolean;
  goals: WeekGoal[];
  onAdd: (text: string) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  /** Last week's unfinished goals that would fit here; 0 hides the offer. */
  leftover: number;
  onBringOver: () => void;
  onDismissLeftover: () => void;
  /** Last week looked back on, until it is put away; null when there is none to show. */
  review?: WeekReview | null;
  onDismissReview?: () => void;
};

/** Up to three things to get done this week, Sunday to Saturday. */
export function WeekGoals(props: Props) {
  const { goals } = props;
  const [draft, setDraft] = useState('');
  const done = goals.filter((g) => g.doneAt !== undefined).length;
  const room = WEEK_GOALS_MAX - goals.length;
  const allDone = goals.length > 0 && done === goals.length;
  const range = weekRangeLabel(props.week);

  const add = () => {
    if (!draft.trim()) return;
    props.onAdd(draft);
    setDraft('');
  };

  return (
    <Card
      icon={Goal}
      accent={colors.week}
      title="This week"
      subtitle={
        allDone
          ? `${range} · all done, nice work`
          : props.isThisWeek
            ? `${range} · up to ${WEEK_GOALS_MAX} goals`
            : `${range} · last week`
      }
      right={
        goals.length > 0 ? (
          <Text style={styles.count} accessibilityLabel={`${done} of ${goals.length} goals done`}>
            {done}/{goals.length}
          </Text>
        ) : undefined
      }
      testID="card-week"
    >
      {props.review ? <Review review={props.review} onDismiss={() => props.onDismissReview?.()} /> : null}

      {props.leftover > 0 ? (
        <View style={styles.carry} testID="goals-carry" accessibilityLiveRegion="polite">
          <Forward size={16} color={colors.week} />
          <Text style={styles.carryText}>
            {props.leftover === 1 ? '1 unfinished goal' : `${props.leftover} unfinished goals`} from last week
          </Text>
          <Pressable
            onPress={props.onBringOver}
            accessibilityRole="button"
            accessibilityLabel={props.leftover === 1 ? 'Bring it into this week' : 'Bring them into this week'}
            style={({ pressed }) => [styles.carryButton, pressed && { opacity: 0.8 }]}
            testID="goals-bring-over"
          >
            <Text style={styles.carryButtonText}>Bring over</Text>
          </Pressable>
          <IconButton icon={X} size={16} label="Not now" onPress={props.onDismissLeftover} color={colors.textMuted} />
        </View>
      ) : null}

      {goals.length === 0 ? (
        <Text style={styles.empty}>
          {props.isThisWeek
            ? 'What would make this a good week? Add up to three things to get done by Saturday.'
            : 'No goals were set for that week.'}
        </Text>
      ) : (
        <View>
          {goals.map((g) => {
            const checked = g.doneAt !== undefined;
            return (
              <View key={g.id} style={styles.row} testID="goal">
                <Pressable
                  onPress={() => props.onToggle(g.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                  accessibilityLabel={g.text}
                  style={({ pressed }) => [styles.toggle, pressed && { opacity: 0.7 }]}
                  testID="goal-check"
                >
                  <View style={[styles.box, checked && styles.boxChecked]}>
                    {checked ? <Check size={15} color={colors.background} strokeWidth={3} /> : null}
                  </View>
                  <Text style={[styles.text, checked && styles.textDone]}>{g.text}</Text>
                </Pressable>
                <IconButton
                  icon={X}
                  size={16}
                  label={`Delete goal: ${g.text}`}
                  onPress={() => props.onDelete(g.id)}
                  color={colors.textMuted}
                />
              </View>
            );
          })}
        </View>
      )}

      {room > 0 ? (
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={add}
            placeholder={goals.length === 0 ? 'e.g. Finish the report' : 'Another goal for the week'}
            {...inputColors}
            selectionColor={tint(colors.week, 0.45)}
            selectionHandleColor={colors.week}
            style={styles.input}
            maxLength={GOAL_MAX_LENGTH}
            returnKeyType="done"
            submitBehavior="submit"
            accessibilityLabel="New goal for the week"
            testID="goal-input"
          />
          <IconButton icon={Plus} label="Add goal" onPress={add} disabled={!draft.trim()} color={colors.week} filled />
        </View>
      ) : allDone ? null : (
        <Text style={styles.full}>Three is plenty. Tick one off or remove one to add another.</Text>
      )}
    </Card>
  );
}

/** "1h 15m", "45m", "2h": short enough for a third of a phone's width. */
export function shortFocus(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Last week in a few numbers: only what was logged is shown. */
function Review({ review, onDismiss }: { review: WeekReview; onDismiss: () => void }) {
  const { money } = useMoney();
  const stats: { label: string; value: string }[] = [];
  if (review.goals.total > 0) stats.push({ label: 'Goals', value: `${review.goals.done} of ${review.goals.total}` });
  if (review.habitRate !== null) stats.push({ label: 'Habits', value: `${Math.round(review.habitRate * 100)}%` });
  if (review.avgMood !== null) stats.push({ label: 'Mood', value: moodWord(review.avgMood) });
  if (review.avgSleep !== null) stats.push({ label: 'Sleep', value: `${review.avgSleep.toFixed(1)} h` });
  if (review.focusMinutes > 0) stats.push({ label: 'Focus', value: shortFocus(review.focusMinutes) });
  if (review.spentCents > 0) stats.push({ label: 'Spent', value: money(review.spentCents) });
  return (
    <View style={styles.review} testID="week-review">
      <View style={styles.reviewHead}>
        <Text style={styles.reviewTitle} accessibilityRole="header">
          Last week · {weekRangeLabel(review.week)}
        </Text>
        <IconButton
          icon={X}
          size={16}
          label="Put last week’s review away"
          onPress={onDismiss}
          color={colors.textMuted}
        />
      </View>
      <View style={styles.stats}>
        {stats.map((s) => (
          <View
            key={s.label}
            style={styles.stat}
            accessible
            accessibilityLabel={`Last week, ${s.label.toLowerCase()}: ${s.value}`}
          >
            <Text style={styles.statLabel}>{s.label}</Text>
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
              {s.value}
            </Text>
          </View>
        ))}
      </View>
      {review.steadiest ? (
        <Text style={styles.steadiest} testID="week-review-steadiest">
          Steadiest habit: {review.steadiest.label}, {review.steadiest.done} of {review.steadiest.due} days
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  review: {
    gap: space.sm,
    backgroundColor: tint(colors.week, 0.08),
    borderRadius: radius.md,
    padding: space.md,
    paddingTop: space.xs,
  },
  reviewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginRight: -space.sm },
  reviewTitle: { ...type.label, color: colors.text, fontWeight: '700', flex: 1 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  stat: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 84,
    backgroundColor: colors.cardRaised,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    gap: 2,
  },
  statLabel: { ...type.caption, color: colors.textSecondary },
  statValue: { fontSize: 16, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  steadiest: { ...type.caption, color: colors.textSecondary },
  count: { ...type.label, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  empty: { ...type.body, color: colors.textMuted },
  row: { flexDirection: 'row', alignItems: 'center' },
  toggle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: HIT,
    paddingVertical: space.xs,
  },
  box: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: { backgroundColor: colors.week, borderColor: colors.week },
  text: { ...type.body, color: colors.text, flex: 1 },
  textDone: { color: colors.textMuted, textDecorationLine: 'line-through' },
  composer: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: HIT,
    backgroundColor: colors.cardRaised,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    color: colors.text,
    ...type.body,
  },
  full: { ...type.caption, color: colors.textSecondary },
  carry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: tint(colors.week, 0.1),
    borderRadius: radius.md,
    paddingLeft: space.md,
    paddingVertical: space.xs,
  },
  carryText: { ...type.label, color: colors.text, flex: 1 },
  carryButton: {
    minHeight: 36,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.week,
    alignItems: 'center',
    justifyContent: 'center',
  },
  carryButtonText: { ...type.label, color: colors.background, fontWeight: '700' },
});
