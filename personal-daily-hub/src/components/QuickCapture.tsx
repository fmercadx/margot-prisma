import { ArrowUp, Lock, NotebookPen, X } from '../icons';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { clockTime } from '../lib/date';
import { FREE_NOTES_PER_DAY } from '../lib/premium';
import { NOTE_MAX_LENGTH, type Note } from '../lib/store';
import { colors, HIT, radius, space, tint, type } from '../theme';
import { Card } from './Card';
import { IconButton } from './IconButton';

type Props = {
  notes: Note[];
  isPremium: boolean;
  draft: string;
  onDraftChange: (text: string) => void;
  onSubmit: () => void;
  onDelete: (id: string) => void;
};

export function QuickCapture({ notes, isPremium, draft, onDraftChange, onSubmit, onDelete }: Props) {
  const atLimit = !isPremium && notes.length >= FREE_NOTES_PER_DAY;
  const canSend = draft.trim().length > 0;

  const counter = isPremium ? (
    <Text style={styles.counter}>{notes.length === 1 ? '1 note' : `${notes.length} notes`}</Text>
  ) : (
    <View
      style={[styles.pill, atLimit && { backgroundColor: tint(colors.premium, 0.14) }]}
      accessibilityLabel={`${notes.length} of ${FREE_NOTES_PER_DAY} free notes used today`}
    >
      {atLimit ? <Lock size={12} color={colors.premium} strokeWidth={2.5} /> : null}
      <Text style={[styles.pillText, atLimit && { color: colors.premium }]}>
        {notes.length}/{FREE_NOTES_PER_DAY} free
      </Text>
    </View>
  );

  return (
    <Card
      icon={NotebookPen}
      accent={colors.notes}
      title="Quick Capture"
      subtitle="Get it out of your head"
      right={counter}
      testID="card-notes"
    >
      <View style={styles.inputRow}>
        <TextInput
          value={draft}
          onChangeText={onDraftChange}
          onSubmitEditing={() => canSend && onSubmit()}
          placeholder="A thought, a task, an idea…"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          maxLength={NOTE_MAX_LENGTH}
          returnKeyType="done"
          submitBehavior="submit"
          accessibilityLabel="New note"
          testID="note-input"
        />
        <Pressable
          onPress={onSubmit}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel="Save note"
          accessibilityState={{ disabled: !canSend }}
          style={({ pressed }) => [
            styles.send,
            { backgroundColor: canSend ? colors.notes : colors.cardRaised },
            pressed && { opacity: 0.8 },
          ]}
          testID="note-submit"
        >
          <ArrowUp size={20} color={canSend ? colors.background : colors.textMuted} strokeWidth={2.5} />
        </Pressable>
      </View>

      {notes.length === 0 ? (
        <Text style={styles.empty}>Nothing captured yet today.</Text>
      ) : (
        // A nested, natively scrolling list: it grows to a few rows, then
        // scrolls inside the card instead of pushing the rest of the page down.
        <ScrollView
          style={styles.list}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          testID="note-list"
        >
          {notes.map((note, i) => (
            <View key={note.id} style={[styles.note, i > 0 && styles.divider]}>
              <View style={[styles.dot, { backgroundColor: colors.notes }]} />
              <View style={styles.noteBody}>
                <Text style={styles.noteText}>{note.text}</Text>
                <Text style={styles.noteTime}>{clockTime(note.createdAt)}</Text>
              </View>
              <IconButton
                icon={X}
                size={16}
                label={`Delete note: ${note.text}`}
                onPress={() => onDelete(note.id)}
                color={colors.textMuted}
              />
            </View>
          ))}
        </ScrollView>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  counter: { ...type.label, color: colors.textSecondary },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.cardRaised,
  },
  pillText: { ...type.caption, color: colors.textSecondary, fontWeight: '600', fontVariant: ['tabular-nums'] },
  inputRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  input: {
    flex: 1,
    minHeight: HIT + 4,
    backgroundColor: colors.cardRaised,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    color: colors.text,
    ...type.body,
  },
  send: {
    width: HIT + 4,
    height: HIT + 4,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { ...type.body, color: colors.textMuted },
  list: { maxHeight: 248 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: space.xs },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 19 },
  noteBody: { flex: 1, paddingVertical: space.sm, gap: 2 },
  noteText: { ...type.body, color: colors.text },
  noteTime: { ...type.caption, color: colors.textMuted, fontVariant: ['tabular-nums'] },
});
