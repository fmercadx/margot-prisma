import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Check, Forward, Goal, Plus, X } from '../icons';
import { weekRangeLabel } from '../lib/date';
import { GOAL_MAX_LENGTH, WEEK_GOALS_MAX, type WeekGoal } from '../lib/store';
import { colors, HIT, inputColors, radius, space, tint, type } from '../theme';
import { Card } from './Card';
import { IconButton } from './IconButton';

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

const styles = StyleSheet.create({
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
