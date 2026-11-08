import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ExpenseLogger } from '../components/ExpenseLogger';
import { HabitChecklist } from '../components/HabitChecklist';
import { Header } from '../components/Header';
import { HistoryCard } from '../components/HistoryCard';
import { PaywallModal } from '../components/PaywallModal';
import { QuickCapture } from '../components/QuickCapture';
import { WaterEnergy } from '../components/WaterEnergy';
import { useToday } from '../hooks/useClock';
import { HISTORY_DAYS, useDailyHub } from '../hooks/useDailyHub';
import { lastNDays } from '../lib/date';
import { canAddCustomHabit, canAddNote, purchasePremiumMock, type PaywallReason } from '../lib/premium';
import {
  disableDailyReminder,
  enableDailyReminder,
  isReminderScheduled,
  remindersSupported,
} from '../lib/reminders';
import { CUSTOM_HABITS_MAX, getDay, HABIT_MAX_LENGTH, newId, totalCents } from '../lib/store';
import { colors, radius, space, type } from '../theme';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const today = useToday();
  const { state, dispatch, ready, loadFailed, saveFailed } = useDailyHub(today);
  const day = getDay(state, today);

  // ---- premium ------------------------------------------------------------
  // Starts false on every launch. A real build would restore this from the
  // App Store / Play Store entitlement here rather than from local storage.
  const [isPremium, setIsPremium] = useState(false);
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);
  // What the person was trying to do when the paywall opened, so unlocking
  // finishes it for them instead of making them do it twice.
  const afterUnlock = useRef<(() => void) | null>(null);

  const openPaywall = (reason: PaywallReason, then?: () => void) => {
    afterUnlock.current = then ?? null;
    setPaywall(reason);
  };

  const closePaywall = () => {
    afterUnlock.current = null;
    setPaywall(null);
  };

  const unlock = async () => {
    const ok = await purchasePremiumMock();
    if (!ok) return;
    setIsPremium(true);
    setPaywall(null);
    const next = afterUnlock.current;
    afterUnlock.current = null;
    next?.();
  };

  // ---- quick capture ------------------------------------------------------
  const [noteDraft, setNoteDraft] = useState('');

  const saveNote = (text: string, date: string) => {
    dispatch({ type: 'addNote', date, note: { id: newId('note'), text, createdAt: Date.now() } });
    setNoteDraft('');
  };

  const submitNote = () => {
    const text = noteDraft.trim();
    if (!text) return;
    if (!canAddNote(day.notes.length, isPremium)) {
      // The draft stays in the box; unlocking saves it.
      openPaywall('notes', () => saveNote(text, today));
      return;
    }
    saveNote(text, today);
  };

  // ---- habits -------------------------------------------------------------
  const [habitComposerOpen, setHabitComposerOpen] = useState(false);

  const requestAddHabit = () => {
    if (canAddCustomHabit(isPremium)) setHabitComposerOpen(true);
    else openPaywall('habits', () => setHabitComposerOpen(true));
  };

  const addHabit = (raw: string): string | null => {
    const label = raw.trim().slice(0, HABIT_MAX_LENGTH);
    if (!label) return 'Give the habit a name.';
    if (state.habits.some((h) => h.label.toLowerCase() === label.toLowerCase())) {
      return 'You already have that habit.';
    }
    if (state.habits.filter((h) => !h.core).length >= CUSTOM_HABITS_MAX) {
      return `You can have up to ${CUSTOM_HABITS_MAX} custom habits.`;
    }
    dispatch({ type: 'addHabit', habit: { id: newId('habit'), label, core: false } });
    return null;
  };

  // ---- reminder -----------------------------------------------------------
  const [reminderOn, setReminderOn] = useState(false);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    isReminderScheduled().then((on) => live && setReminderOn(on));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 3500);
    return () => clearTimeout(t);
  }, [message]);

  const toggleReminder = async () => {
    setReminderBusy(true);
    try {
      if (reminderOn) {
        await disableDailyReminder();
        setReminderOn(false);
        setMessage('Daily reminder off.');
      } else {
        const result = await enableDailyReminder();
        if (result === 'enabled') {
          setReminderOn(true);
          setMessage('We’ll nudge you at 8:00 PM each day.');
        } else if (result === 'denied') {
          setMessage('Notifications are off for Daily Hub. Turn them on in Settings.');
        } else {
          setMessage('Couldn’t set the reminder. Please try again.');
        }
      }
    } finally {
      setReminderBusy(false);
    }
  };

  // ---- layout -------------------------------------------------------------
  const [scrollEnabled, setScrollEnabled] = useState(true);

  const history = useMemo(
    () => lastNDays(today, HISTORY_DAYS).map((date) => ({ date, log: state.days[date] ?? null })),
    [today, state.days],
  );

  if (!ready) {
    return (
      <View style={[styles.fill, styles.center]}>
        <ActivityIndicator color={colors.textSecondary} />
      </View>
    );
  }

  return (
    // iOS: the ScrollView insets itself for the keyboard. Android: edge-to-edge
    // means the window no longer resizes, so pad for the keyboard here.
    <KeyboardAvoidingView style={styles.fill} behavior="padding" enabled={Platform.OS === 'android'}>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + space.xxl },
        ]}
        scrollEnabled={scrollEnabled}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
        testID="home-scroll"
      >
        <View style={styles.column}>
          <Header
            isPremium={isPremium}
            onPremiumPress={() => openPaywall('upgrade')}
            reminder={{
              supported: remindersSupported,
              on: reminderOn,
              busy: reminderBusy,
              onToggle: toggleReminder,
            }}
            message={message}
          />

          {loadFailed ? (
            <Banner text="Couldn’t read your saved data. To keep it safe, changes made now won’t be saved." />
          ) : saveFailed ? (
            <Banner text="Changes aren’t being saved right now. We’ll keep trying." />
          ) : null}

          <QuickCapture
            notes={day.notes}
            isPremium={isPremium}
            draft={noteDraft}
            onDraftChange={setNoteDraft}
            onSubmit={submitNote}
            onDelete={(id) => dispatch({ type: 'deleteNote', date: today, id })}
          />

          <HabitChecklist
            habits={state.habits}
            done={day.habitsDone}
            isPremium={isPremium}
            composerOpen={habitComposerOpen}
            onToggle={(id) => dispatch({ type: 'toggleHabit', date: today, id })}
            onRemove={(id) => dispatch({ type: 'removeHabit', date: today, id })}
            onRequestAdd={requestAddHabit}
            onCloseComposer={() => setHabitComposerOpen(false)}
            onAdd={addHabit}
          />

          <WaterEnergy
            water={day.water}
            energy={day.energy}
            onAdjustWater={(delta) => dispatch({ type: 'adjustWater', date: today, delta })}
            onSetEnergy={(value) => dispatch({ type: 'setEnergy', date: today, value })}
            onDragStateChange={(dragging) => setScrollEnabled(!dragging)}
          />

          <ExpenseLogger
            expenses={day.expenses}
            totalCents={totalCents(day)}
            onAdd={(cents, label) =>
              dispatch({
                type: 'addExpense',
                date: today,
                expense: { id: newId('exp'), cents, label, createdAt: Date.now() },
              })
            }
            onDelete={(id) => dispatch({ type: 'deleteExpense', date: today, id })}
          />

          <HistoryCard isPremium={isPremium} days={history} onUnlock={() => openPaywall('history')} />
        </View>
      </ScrollView>

      <PaywallModal reason={paywall} onClose={closePaywall} onUnlock={unlock} />
    </KeyboardAvoidingView>
  );
}

function Banner({ text }: { text: string }) {
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.bannerText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: space.lg },
  // Phones use the full width; on a tablet the column stays readable.
  column: { width: '100%', maxWidth: 640, alignSelf: 'center', gap: space.lg },
  banner: {
    backgroundColor: 'rgba(248,113,113,0.12)',
    borderRadius: radius.md,
    padding: space.md,
  },
  bannerText: { ...type.label, color: colors.text },
});
