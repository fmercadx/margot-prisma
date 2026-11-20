import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Check, Play, Square, Target, Timer, X } from '../icons';
import { FOCUS_MAX_LENGTH, focusLabel } from '../lib/store';
import { colors, HIT, inputColors, radius, space, tint, type } from '../theme';
import { IconButton } from './IconButton';

/** The focus timer, on today only. */
export type FocusTimerProps = {
  /** The session under way, or null. */
  running: { startedAt: number; endsAt: number } | null;
  /** Minutes in a new session. */
  length: number;
  onStart: () => void;
  onStop: () => void;
};

type Props = {
  focus: string;
  /** Saves the day's focus. Saving blank text clears it. */
  onSave: (text: string) => void;
  /** "today", "yesterday" or "on Tuesday": the day being logged. */
  dayWord?: string;
  /** Minutes of focus sessions finished that day. */
  focusMinutes?: number;
  timer?: FocusTimerProps;
};

/** One line for the thing that matters most today. Tap it to change it. */
export function TodayFocus({ focus, onSave, dayWord = 'today', focusMinutes = 0, timer }: Props) {
  const [draft, setDraft] = useState<string | null>(null); // null = not editing
  const editing = draft !== null;
  const today = dayWord === 'today';
  const title = today ? 'Today’s focus' : `Focus ${dayWord}`;
  const prompt = today ? 'What matters most today?' : 'What mattered most that day?';

  const save = () => {
    if (draft === null) return;
    onSave(draft);
    setDraft(null);
  };

  return (
    <View style={styles.wrap} testID="today-focus">
      <View style={styles.top}>
        <View style={styles.icon}>
          <Target size={18} color={colors.focus} strokeWidth={2.25} />
        </View>

        {editing ? (
          <>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={save}
              placeholder={prompt}
              {...inputColors}
              style={styles.input}
              maxLength={FOCUS_MAX_LENGTH}
              autoFocus
              returnKeyType="done"
              submitBehavior="submit"
              accessibilityLabel={title}
              testID="focus-input"
            />
            <IconButton icon={Check} size={18} label="Save focus" onPress={save} color={colors.focus} />
            <IconButton icon={X} size={18} label="Cancel focus" onPress={() => setDraft(null)} />
          </>
        ) : (
          <Pressable
            onPress={() => setDraft(focus)}
            accessibilityRole="button"
            accessibilityLabel={
              focus ? `${title}: ${focus}. Tap to change it` : today ? 'Set today’s focus' : `Set the focus ${dayWord}`
            }
            style={({ pressed }) => [styles.body, pressed && { opacity: 0.7 }]}
            testID="focus-edit"
          >
            <Text style={styles.label}>{title}</Text>
            <Text style={[styles.text, !focus && styles.placeholder]} testID="focus-text">
              {focus || prompt}
            </Text>
          </Pressable>
        )}
      </View>

      {timer ? (
        <FocusTimerRow {...timer} minutesToday={focusMinutes} />
      ) : focusMinutes > 0 ? (
        <View style={styles.timerRow}>
          <Timer size={15} color={colors.textSecondary} />
          <Text style={styles.minutes} testID="focus-minutes">
            Focused for {focusLabel(focusMinutes)} {dayWord}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function FocusTimerRow({ running, length, onStart, onStop, minutesToday }: FocusTimerProps & { minutesToday: number }) {
  return (
    <View style={styles.timerRow}>
      {running ? (
        <FocusClock startedAt={running.startedAt} endsAt={running.endsAt} />
      ) : (
        <Text style={styles.minutes} testID="focus-minutes">
          {minutesToday > 0 ? `Focused for ${focusLabel(minutesToday)} today` : 'No focus sessions yet today'}
        </Text>
      )}
      {running ? (
        <Pressable
          onPress={onStop}
          accessibilityRole="button"
          accessibilityLabel="Stop the focus session"
          accessibilityHint="The minutes done so far are kept"
          style={({ pressed }) => [styles.timerButton, pressed && { opacity: 0.7 }]}
          testID="focus-stop"
        >
          <Square size={13} color={colors.text} fill={colors.text} />
          <Text style={styles.timerButtonText}>Stop</Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={onStart}
          accessibilityRole="button"
          accessibilityLabel={`Start a ${length}-minute focus session`}
          style={({ pressed }) => [styles.timerButton, styles.timerStart, pressed && { opacity: 0.8 }]}
          testID="focus-start"
        >
          <Play size={13} color={colors.background} fill={colors.background} />
          <Text style={[styles.timerButtonText, { color: colors.background }]}>{length} min</Text>
        </Pressable>
      )}
    </View>
  );
}

/** "18:42" */
export function clockText(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Time left, re-drawn each second here only, so the rest of the screen stays still. */
function FocusClock({ startedAt, endsAt }: { startedAt: number; endsAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = endsAt - now;
  const share = Math.min(1, Math.max(0, (now - startedAt) / (endsAt - startedAt)));
  const minutesLeft = Math.max(0, Math.ceil(left / 60_000));
  return (
    <View
      style={styles.clock}
      accessible
      accessibilityRole="timer"
      accessibilityLabel={`Focus session: ${minutesLeft} ${minutesLeft === 1 ? 'minute' : 'minutes'} left`}
      testID="focus-clock"
    >
      <Text style={styles.clockText}>{clockText(left)}</Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${share * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: space.sm,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 40 },
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
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  minutes: { ...type.label, color: colors.textSecondary, flex: 1 },
  timerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: HIT,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.cardRaised,
  },
  timerStart: { backgroundColor: colors.focus },
  timerButtonText: { ...type.label, color: colors.text, fontWeight: '700' },
  clock: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  clockText: { ...type.title, color: colors.text, fontVariant: ['tabular-nums'], minWidth: 52 },
  track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: tint(colors.focus, 0.18), overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.focus },
});
