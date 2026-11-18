import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Check, Target, X } from '../icons';
import { FOCUS_MAX_LENGTH } from '../lib/store';
import { colors, HIT, inputColors, radius, space, tint, type } from '../theme';
import { IconButton } from './IconButton';

type Props = {
  focus: string;
  /** Saves the day's focus. Saving blank text clears it. */
  onSave: (text: string) => void;
};

/** One line for the thing that matters most today. Tap it to change it. */
export function TodayFocus({ focus, onSave }: Props) {
  const [draft, setDraft] = useState<string | null>(null); // null = not editing
  const editing = draft !== null;

  const save = () => {
    if (draft === null) return;
    onSave(draft);
    setDraft(null);
  };

  return (
    <View style={styles.wrap} testID="today-focus">
      <View style={styles.icon}>
        <Target size={18} color={colors.focus} strokeWidth={2.25} />
      </View>

      {editing ? (
        <>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={save}
            placeholder="What matters most today?"
            {...inputColors}
            style={styles.input}
            maxLength={FOCUS_MAX_LENGTH}
            autoFocus
            returnKeyType="done"
            submitBehavior="submit"
            accessibilityLabel="Today’s focus"
            testID="focus-input"
          />
          <IconButton icon={Check} size={18} label="Save focus" onPress={save} color={colors.focus} />
          <IconButton icon={X} size={18} label="Cancel focus" onPress={() => setDraft(null)} />
        </>
      ) : (
        <Pressable
          onPress={() => setDraft(focus)}
          accessibilityRole="button"
          accessibilityLabel={focus ? `Today’s focus: ${focus}. Tap to change it` : 'Set today’s focus'}
          style={({ pressed }) => [styles.body, pressed && { opacity: 0.7 }]}
          testID="focus-edit"
        >
          <Text style={styles.label}>Today’s focus</Text>
          <Text style={[styles.text, !focus && styles.placeholder]} testID="focus-text">
            {focus || 'What matters most today?'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: 64,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: tint(colors.focus),
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2, minHeight: HIT, justifyContent: 'center' },
  label: { ...type.caption, color: colors.textSecondary },
  text: { ...type.body, fontWeight: '600', color: colors.text },
  placeholder: { color: colors.textMuted, fontWeight: '400' },
  input: {
    flex: 1,
    minHeight: HIT,
    backgroundColor: colors.cardRaised,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    color: colors.text,
    ...type.body,
  },
});
