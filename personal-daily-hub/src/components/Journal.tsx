import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { BookHeart, Sparkles } from '../icons';
import { parseDateKey } from '../lib/date';
import { cleanGratitude, cleanJournal, GRATITUDE_MAX, GRATITUDE_MAX_LENGTH, JOURNAL_MAX_LENGTH } from '../lib/store';
import { colors, inputColors, HIT, radius, space, type } from '../theme';
import { Card } from './Card';

/** A different question each weekday, so the page is never blank in the same way twice. */
export const JOURNAL_PROMPTS = [
  'What made you smile today?', // Sunday
  'What did you get done today?',
  'What did you learn today?',
  'What was harder than it should have been?',
  'Who made your day better?',
  'What are you proud of this week?',
  'What would you like to remember about today?',
];

export function journalPrompt(date: string): string {
  return JOURNAL_PROMPTS[parseDateKey(date).getDay()];
}

type Props = {
  date: string;
  entry: string;
  /** Saves the entry. Saving blank text clears it. */
  onSave: (text: string) => void;
  /** The day's three good things, and saving them. */
  gratitude?: string[];
  onSaveGratitude?: (items: string[]) => void;
};

/**
 * A few lines at the end of the day. Typing stays in a draft until Save,
 * until the field loses focus, or until the app goes to the background or
 * the card goes away (the lock screen replaces it), so a half-written
 * thought is neither saved on every keystroke nor lost.
 */
export function Journal({ date, entry, onSave, gratitude, onSaveGratitude }: Props) {
  const [draft, setDraft] = useState(entry);
  const changed = cleanJournal(draft) !== entry;

  // The entry can change from outside (a restore fills it in, erasing
  // clears it). Follow it unless there are unsaved edits.
  const shown = useRef(entry);
  useEffect(() => {
    if (draft === shown.current) setDraft(entry);
    shown.current = entry;
    // Only when the saved entry changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry]);

  const latest = useRef({ draft, entry, onSave });
  latest.current = { draft, entry, onSave };
  useEffect(() => {
    const flush = () => {
      const { draft: d, entry: e, onSave: save } = latest.current;
      if (cleanJournal(d) !== e) save(d);
    };
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') flush();
    });
    return () => {
      sub.remove();
      flush();
    };
  }, []);

  const save = () => {
    if (changed) onSave(draft);
  };

  return (
    <Card icon={BookHeart} accent={colors.journal} title="Journal" subtitle={journalPrompt(date)} testID="card-journal">
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onBlur={save}
        placeholder="A few lines, just for you…"
        {...inputColors}
        style={styles.input}
        multiline
        textAlignVertical="top"
        maxLength={JOURNAL_MAX_LENGTH}
        accessibilityLabel="Journal entry"
        accessibilityHint={journalPrompt(date)}
        testID="journal-input"
      />
      <View style={styles.foot}>
        <Text style={styles.count}>
          {draft.length > JOURNAL_MAX_LENGTH * 0.8
            ? `${draft.length}/${JOURNAL_MAX_LENGTH}`
            : changed
              ? 'Not saved yet'
              : entry
                ? 'Saved'
                : ''}
        </Text>
        <Pressable
          onPress={save}
          disabled={!changed}
          accessibilityRole="button"
          accessibilityLabel="Save journal"
          accessibilityState={{ disabled: !changed }}
          style={({ pressed }) => [styles.save, !changed && styles.saveOff, pressed && { opacity: 0.8 }]}
          testID="journal-save"
        >
          <Text style={[styles.saveText, !changed && styles.saveTextOff]}>Save</Text>
        </Pressable>
      </View>
      {gratitude && onSaveGratitude ? <GoodThings items={gratitude} onSave={onSaveGratitude} /> : null}
    </Card>
  );
}

const GOOD_PLACEHOLDERS = ['One good thing, however small', 'Another one', 'And one more'];
const pad = (items: string[]) => Array.from({ length: GRATITUDE_MAX }, (_, i) => items[i] ?? '');
const same = (a: string[], b: string[]) => cleanGratitude(a).join('\n') === b.join('\n');

/**
 * "Three good things": a short gratitude list. Each line saves when it loses
 * focus, and anything unsaved is kept when the app goes to the background or
 * the card goes away, like the journal entry.
 */
function GoodThings({ items, onSave }: { items: string[]; onSave: (items: string[]) => void }) {
  const [drafts, setDrafts] = useState(() => pad(items));

  // Follow outside changes (a restore, erasing) unless there are unsaved edits.
  const shown = useRef(items);
  useEffect(() => {
    if (same(drafts, shown.current)) setDrafts(pad(items));
    shown.current = items;
    // Only when the saved list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const latest = useRef({ drafts, items, onSave });
  latest.current = { drafts, items, onSave };
  useEffect(() => {
    const flush = () => {
      const { drafts: d, items: saved, onSave: save } = latest.current;
      if (!same(d, saved)) save(d);
    };
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') flush();
    });
    return () => {
      sub.remove();
      flush();
    };
  }, []);

  const save = () => {
    if (!same(drafts, items)) onSave(drafts);
  };

  return (
    <View style={styles.good} testID="good-things">
      <View style={styles.goodHead}>
        <Sparkles size={15} color={colors.journal} />
        <Text style={styles.goodTitle} accessibilityRole="header">
          Three good things
        </Text>
      </View>
      {drafts.map((value, i) => (
        <View key={i} style={styles.goodRow}>
          <Text style={styles.goodNumber}>{i + 1}</Text>
          <TextInput
            value={value}
            onChangeText={(t) => setDrafts((d) => d.map((x, j) => (j === i ? t : x)))}
            onBlur={save}
            onSubmitEditing={save}
            placeholder={GOOD_PLACEHOLDERS[i]}
            {...inputColors}
            style={styles.goodInput}
            maxLength={GRATITUDE_MAX_LENGTH}
            returnKeyType="done"
            submitBehavior="blurAndSubmit"
            accessibilityLabel={`Good thing ${i + 1}`}
            testID={`good-${i + 1}`}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 112,
    maxHeight: 260,
    backgroundColor: colors.cardRaised,
    borderRadius: radius.md,
    padding: space.md,
    color: colors.text,
    ...type.body,
    lineHeight: 22,
  },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { ...type.caption, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  save: {
    minHeight: HIT - 8,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.journal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveOff: { backgroundColor: colors.cardRaised },
  saveText: { ...type.label, color: colors.background, fontWeight: '700' },
  saveTextOff: { color: colors.textMuted },
  good: {
    gap: space.sm,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  goodHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  goodTitle: { ...type.label, color: colors.text },
  goodRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  goodNumber: { ...type.label, color: colors.textMuted, width: 14, textAlign: 'center', fontVariant: ['tabular-nums'] },
  goodInput: {
    flex: 1,
    minWidth: 0,
    minHeight: HIT,
    backgroundColor: colors.cardRaised,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    color: colors.text,
    ...type.body,
  },
});
