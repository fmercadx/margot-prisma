import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BookHeart, Goal, NotebookPen, Pin, Search, SearchX, Sparkles, Target, Wallet, X } from '../icons';
import { clockTime, longDate, parseDateKey, weekdayName, weekRangeLabel } from '../lib/date';
import { SEARCH_QUERY_MAX, searchDays, type SearchHit } from '../lib/search';
import type { DayLog, Pinned, WeekGoal } from '../lib/store';
import { colors, HIT, inputColors, radius, space, tint, type } from '../theme';
import { IconButton } from './IconButton';

type Props = {
  visible: boolean;
  /** Every stored day, or null while they are still being read. */
  days: Record<string, DayLog> | null;
  /** Pinned notes, which belong to no day. */
  pinned?: Pinned[];
  /** Weekly goals, which belong to a week rather than a day. */
  goals?: WeekGoal[];
  today: string;
  onClose: () => void;
};

const KIND = {
  note: { icon: NotebookPen, color: colors.notes, name: 'Note' },
  focus: { icon: Target, color: colors.focus, name: 'Focus' },
  journal: { icon: BookHeart, color: colors.journal, name: 'Journal' },
  good: { icon: Sparkles, color: colors.journal, name: 'Good thing' },
  pinned: { icon: Pin, color: colors.notes, name: 'Pinned' },
  goal: { icon: Goal, color: colors.week, name: 'Weekly goal' },
  expense: { icon: Wallet, color: colors.expenses, name: 'Expense' },
} as const;

/** Search every note, focus and expense label on the phone. */
export function SearchSheet({ visible, days, pinned, goals, today, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const result = useMemo(
    () => (days ? searchDays(days, query, undefined, pinned, goals) : { hits: [], total: 0 }),
    [days, query, pinned, goals],
  );
  const typed = query.trim().length > 0;

  const close = () => {
    setQuery('');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={close}
      statusBarTranslucent={Platform.OS === 'android'}
      navigationBarTranslucent={Platform.OS === 'android'}
    >
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable
          style={styles.backdrop}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Dismiss search"
        />
        <View
          style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}
          accessibilityViewIsModal
          testID="search-sheet"
        >
          <View style={styles.head}>
            <View style={styles.field}>
              <Search size={18} color={colors.textSecondary} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search notes, journal, good things, expenses…"
                {...inputColors}
                style={styles.input}
                maxLength={SEARCH_QUERY_MAX}
                autoFocus
                autoCorrect={false}
                returnKeyType="search"
                accessibilityLabel="Search"
                testID="search-input"
              />
              {typed ? (
                <IconButton
                  icon={X}
                  size={16}
                  label="Clear search"
                  onPress={() => setQuery('')}
                  color={colors.textMuted}
                />
              ) : null}
            </View>
            <IconButton icon={X} label="Close search" onPress={close} filled />
          </View>

          {days === null ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.textSecondary} />
            </View>
          ) : !typed ? (
            <Text style={styles.hint}>Everything you have written, on every day, is searched here on your phone.</Text>
          ) : result.total === 0 ? (
            <View style={styles.center}>
              <SearchX size={22} color={colors.textMuted} />
              <Text style={styles.hint} testID="search-empty">
                Nothing matches “{query.trim()}”.
              </Text>
            </View>
          ) : (
            <>
              <Text style={styles.count} accessibilityLiveRegion="polite" testID="search-count">
                {result.total > result.hits.length
                  ? `Showing the newest ${result.hits.length} of ${result.total} matches`
                  : result.total === 1
                    ? '1 match'
                    : `${result.total} matches`}
              </Text>
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.list}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
              >
                {result.hits.map((h) => (
                  <Hit key={`${h.kind}-${h.date}-${h.id}`} hit={h} today={today} />
                ))}
              </ScrollView>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Hit({ hit, today }: { hit: SearchHit; today: string }) {
  const k = KIND[hit.kind];
  const Icon = k.icon;
  const d = parseDateKey(hit.date);
  const day =
    hit.kind === 'goal'
      ? `Week of ${weekRangeLabel(hit.date)}, ${d.getFullYear()}`
      : hit.date === today
        ? 'Today'
        : `${weekdayName(d).slice(0, 3)}, ${longDate(d)}`;
  const when = hit.time === null ? day : `${day} · ${clockTime(hit.time)}`;
  const before = hit.text.slice(0, hit.start);
  const found = hit.text.slice(hit.start, hit.start + hit.length);
  const after = hit.text.slice(hit.start + hit.length);
  return (
    <View style={styles.hit} accessible accessibilityLabel={`${k.name}, ${when}: ${hit.text}`} testID="search-hit">
      <View style={[styles.kind, { backgroundColor: tint(k.color) }]}>
        <Icon size={14} color={k.color} strokeWidth={2.25} />
      </View>
      <View style={styles.hitBody}>
        <Text style={styles.hitText}>
          {before}
          <Text style={styles.mark}>{found}</Text>
          {after}
        </Text>
        <Text style={styles.meta}>{when}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.backdrop },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingTop: space.lg,
    width: '100%',
    maxWidth: 560,
    height: '88%',
    alignSelf: 'center',
    gap: space.md,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: HIT + 4,
    backgroundColor: colors.cardRaised,
    borderRadius: radius.md,
    paddingLeft: space.md,
  },
  input: { flex: 1, minWidth: 0, color: colors.text, ...type.body, paddingVertical: 0 },
  center: { alignItems: 'center', gap: space.sm, paddingVertical: space.xl },
  hint: { ...type.body, color: colors.textMuted, textAlign: 'center', paddingHorizontal: space.xl },
  count: { ...type.caption, color: colors.textSecondary, paddingHorizontal: space.xl },
  scroll: { flex: 1 },
  list: { paddingHorizontal: space.lg, paddingBottom: space.lg },
  hit: {
    flexDirection: 'row',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  kind: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  hitBody: { flex: 1, gap: 2 },
  hitText: { ...type.body, color: colors.text },
  mark: { fontWeight: '700', backgroundColor: tint(colors.notes, 0.3) },
  meta: { ...type.caption, color: colors.textMuted, fontVariant: ['tabular-nums'] },
});
