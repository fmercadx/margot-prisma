import { Check, CircleCheckBig, Lock, Plus, X } from '../icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { HABIT_MAX_LENGTH, type Habit } from '../lib/store';
import { colors, inputColors, HIT, radius, space, type } from '../theme';
import { Card } from './Card';
import { IconButton } from './IconButton';

type Props = {
  habits: Habit[];
  done: string[];
  isPremium: boolean;
  composerOpen: boolean;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  /** Free users get the paywall; premium users get the composer. */
  onRequestAdd: () => void;
  onCloseComposer: () => void;
  /** Returns null on success, or the reason the habit was not added. */
  onAdd: (label: string) => string | null;
};

export function HabitChecklist(props: Props) {
  const { habits, done, isPremium, composerOpen } = props;
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const doneCount = habits.filter((h) => done.includes(h.id)).length;

  const submit = () => {
    const problem = props.onAdd(draft);
    setError(problem);
    if (problem === null) {
      setDraft('');
      props.onCloseComposer();
    }
  };

  const cancel = () => {
    setDraft('');
    setError(null);
    props.onCloseComposer();
  };

  return (
    <Card
      icon={CircleCheckBig}
      accent={colors.habits}
      title="Habits"
      subtitle={doneCount === habits.length ? 'All done — nice work' : 'Small wins, every day'}
      right={
        <Text style={styles.count} accessibilityLabel={`${doneCount} of ${habits.length} habits done`}>
          {doneCount}/{habits.length}
        </Text>
      }
      testID="card-habits"
    >
      <View>
        {habits.map((habit) => {
          const checked = done.includes(habit.id);
          return (
            <View key={habit.id} style={styles.row}>
              <Pressable
                onPress={() => props.onToggle(habit.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                accessibilityLabel={habit.label}
                style={({ pressed }) => [styles.toggle, pressed && { opacity: 0.7 }]}
                testID={`habit-${habit.id}`}
              >
                <View style={[styles.box, checked && styles.boxChecked]}>
                  {checked ? <Check size={15} color={colors.background} strokeWidth={3} /> : null}
                </View>
                <Text style={[styles.label, checked && styles.labelDone]}>{habit.label}</Text>
              </Pressable>
              {habit.core ? null : (
                <IconButton
                  icon={X}
                  size={16}
                  label={`Remove habit: ${habit.label}`}
                  onPress={() => props.onRemove(habit.id)}
                  color={colors.textMuted}
                />
              )}
            </View>
          );
        })}
      </View>

      {composerOpen ? (
        <View style={styles.composer}>
          <View style={styles.composerRow}>
            <TextInput
              value={draft}
              onChangeText={(t) => {
                setDraft(t);
                setError(null);
              }}
              onSubmitEditing={submit}
              placeholder="e.g. Stretch for 5 minutes"
              {...inputColors}
              style={styles.input}
              maxLength={HABIT_MAX_LENGTH}
              autoFocus
              returnKeyType="done"
              submitBehavior="submit"
              accessibilityLabel="New habit name"
              testID="habit-input"
            />
            <IconButton icon={Check} label="Add habit" onPress={submit} color={colors.habits} filled />
            <IconButton icon={X} label="Cancel" onPress={cancel} filled />
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      ) : (
        <Pressable
          onPress={props.onRequestAdd}
          accessibilityRole="button"
          accessibilityLabel={isPremium ? 'Add a custom habit' : 'Add a custom habit (Premium)'}
          style={({ pressed }) => [styles.addButton, pressed && { opacity: 0.7 }]}
          testID="habit-add"
        >
          <Plus size={16} color={colors.textSecondary} strokeWidth={2.5} />
          <Text style={styles.addText}>Add custom habit</Text>
          {isPremium ? null : <Lock size={13} color={colors.premium} strokeWidth={2.5} />}
        </Pressable>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  count: { ...type.label, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
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
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: { backgroundColor: colors.habits, borderColor: colors.habits },
  label: { ...type.body, color: colors.text, flex: 1 },
  labelDone: { color: colors.textMuted, textDecorationLine: 'line-through' },
  composer: { gap: space.xs },
  composerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: {
    flex: 1,
    minHeight: HIT,
    backgroundColor: colors.cardRaised,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    color: colors.text,
    ...type.body,
  },
  error: { ...type.caption, color: colors.danger },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: HIT,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.hairline,
  },
  addText: { ...type.label, color: colors.textSecondary },
});
