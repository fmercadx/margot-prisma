import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ArrowUp, Check, Circle, CircleCheck, Forward, ListTodo, Lock, NotebookPen, Search, X } from '../icons';

import { clockTime, parseDateKey, weekdayName } from '../lib/date';
import { FREE_NOTES_PER_DAY } from '../lib/premium';
import { NOTE_MAX_LENGTH, type Note } from '../lib/store';
import { colors, inputColors, HIT, radius, space, tint, type } from '../theme';
import { Card } from './Card';
import { IconButton } from './IconButton';

type Props = {
  notes: Note[];
  isPremium: boolean;
  draft: string;
  onDraftChange: (text: string) => void;
  onSubmit: () => void;
  onDelete: (id: string) => void;
  /** Saves new text for a note. Blank text is refused (delete it instead). */
  onEdit: (id: string, text: string) => void;
  /** Opens search across every day. */
  onSearch: () => void;
  /** The next capture is a to-do rather than a note. */
  taskMode: boolean;
  onTaskModeChange: (on: boolean) => void;
  onToggleTask: (id: string) => void;
  /** Unfinished to-dos from earlier days, offered to bring over to today. */
  carry: { count: number; from: string } | null;
  onCarry: () => void;
  onDismissCarry: () => void;
};

export function QuickCapture(p: Props) {
  const { notes, isPremium, draft, onDraftChange, onSubmit, onDelete, onEdit, onSearch } = p;
  // One note at a time is open for editing.
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const saveEdit = () => {
    if (!editing || !editing.text.trim()) return;
    onEdit(editing.id, editing.text);
    setEditing(null);
  };
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
      right={
        <View style={styles.right}>
          {counter}
          <IconButton icon={Search} size={18} label="Search all notes" onPress={onSearch} testID="open-search" />
        </View>
      }
      testID="card-notes"
    >
      {p.carry ? (
        <View style={styles.carry} testID="carry-banner" accessibilityLiveRegion="polite">
          <Forward size={16} color={colors.notes} />
          <Text style={styles.carryText}>
            {p.carry.count === 1 ? '1 unfinished to-do' : `${p.carry.count} unfinished to-dos`} from {p.carry.from}
          </Text>
          <Pressable
            onPress={p.onCarry}
            accessibilityRole="button"
            accessibilityLabel={p.carry.count === 1 ? 'Bring it over to today' : 'Bring them over to today'}
            style={({ pressed }) => [styles.carryButton, pressed && { opacity: 0.8 }]}
            testID="carry-over"
          >
            <Text style={styles.carryButtonText}>Bring over</Text>
          </Pressable>
          <IconButton icon={X} size={16} label="Not now" onPress={p.onDismissCarry} color={colors.textMuted} />
        </View>
      ) : null}

      <View style={styles.inputRow}>
        <Pressable
          onPress={() => p.onTaskModeChange(!p.taskMode)}
          accessibilityRole="switch"
          accessibilityState={{ checked: p.taskMode }}
          accessibilityLabel="Add as a to-do"
          style={({ pressed }) => [styles.mode, p.taskMode && styles.modeOn, pressed && { opacity: 0.75 }]}
          testID="task-mode"
        >
          <ListTodo size={20} color={p.taskMode ? colors.notes : colors.textMuted} strokeWidth={2.25} />
        </Pressable>
        <TextInput
          value={draft}
          onChangeText={onDraftChange}
          onSubmitEditing={() => canSend && onSubmit()}
          placeholder={p.taskMode ? 'A to-do for today…' : 'A thought, a task, an idea…'}
          {...inputColors}
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
          accessibilityLabel={p.taskMode ? 'Save to-do' : 'Save note'}
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
          {notes.map((note, i) =>
            editing?.id === note.id ? (
              <View key={note.id} style={[styles.note, styles.editRow, i > 0 && styles.divider]}>
                <TextInput
                  value={editing.text}
                  onChangeText={(text) => setEditing({ id: note.id, text })}
                  onSubmitEditing={saveEdit}
                  {...inputColors}
                  style={styles.editInput}
                  maxLength={NOTE_MAX_LENGTH}
                  autoFocus
                  returnKeyType="done"
                  submitBehavior="submit"
                  accessibilityLabel="Edit note"
                  testID="note-edit-input"
                />
                <IconButton
                  icon={Check}
                  size={18}
                  label="Save changes"
                  onPress={saveEdit}
                  disabled={!editing.text.trim()}
                  color={colors.notes}
                />
                <IconButton icon={X} size={18} label="Cancel editing" onPress={() => setEditing(null)} />
              </View>
            ) : (
              <View key={note.id} style={[styles.note, i > 0 && styles.divider]}>
                {note.task ? (
                  <Pressable
                    onPress={() => p.onToggleTask(note.id)}
                    hitSlop={10}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: note.doneAt !== undefined }}
                    accessibilityLabel={`Done: ${note.text}`}
                    style={styles.check}
                    testID="task-check"
                  >
                    {note.doneAt !== undefined ? (
                      <CircleCheck size={20} color={colors.notes} strokeWidth={2.25} />
                    ) : (
                      <Circle size={20} color={colors.textSecondary} strokeWidth={2} />
                    )}
                  </Pressable>
                ) : (
                  <View style={[styles.dot, { backgroundColor: colors.notes }]} />
                )}
                <Pressable
                  onPress={() => setEditing({ id: note.id, text: note.text })}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${note.task ? 'to-do' : 'note'}: ${note.text}`}
                  style={({ pressed }) => [styles.noteBody, pressed && { opacity: 0.7 }]}
                >
                  <Text style={[styles.noteText, note.doneAt !== undefined && styles.doneText]}>{note.text}</Text>
                  <Text style={styles.noteTime}>
                    {clockTime(note.createdAt)}
                    {note.editedAt ? ' · edited' : ''}
                    {note.carriedFrom ? ` · from ${weekdayName(parseDateKey(note.carriedFrom))}` : ''}
                  </Text>
                </Pressable>
                <IconButton
                  icon={X}
                  size={16}
                  label={`Delete ${note.task ? 'to-do' : 'note'}: ${note.text}`}
                  onPress={() => onDelete(note.id)}
                  color={colors.textMuted}
                />
              </View>
            ),
          )}
        </ScrollView>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  right: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginRight: -space.sm },
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
  mode: {
    width: HIT,
    height: HIT + 4,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cardRaised,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  modeOn: { backgroundColor: tint(colors.notes, 0.16), borderColor: colors.notes },
  carry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: tint(colors.notes, 0.1),
    borderRadius: radius.md,
    paddingLeft: space.md,
    paddingVertical: space.xs,
  },
  carryText: { ...type.label, color: colors.text, flex: 1 },
  carryButton: {
    minHeight: 36,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.notes,
    alignItems: 'center',
    justifyContent: 'center',
  },
  carryButtonText: { ...type.label, color: colors.background, fontWeight: '700' },
  check: { width: 24, height: 24, marginTop: 12, alignItems: 'center', justifyContent: 'center' },
  doneText: { color: colors.textMuted, textDecorationLine: 'line-through' },
  input: {
    flex: 1,
    minWidth: 0, // let it shrink: a web <input> otherwise keeps its default width and pushes the send button out
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
  editRow: { alignItems: 'center', paddingVertical: space.sm },
  editInput: {
    flex: 1,
    minHeight: HIT,
    backgroundColor: colors.cardRaised,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    color: colors.text,
    ...type.body,
  },
  noteTime: { ...type.caption, color: colors.textMuted, fontVariant: ['tabular-nums'] },
});
