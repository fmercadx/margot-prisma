import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

import appConfig from '../../app.json';
import { ExpenseLogger } from '../components/ExpenseLogger';
import { HabitChecklist } from '../components/HabitChecklist';
import { Header } from '../components/Header';
import { HistoryCard } from '../components/HistoryCard';
import { LockScreen } from '../components/LockScreen';
import { PaywallModal } from '../components/PaywallModal';
import { QuickCapture } from '../components/QuickCapture';
import { SettingsSheet } from '../components/SettingsSheet';
import { UndoToast } from '../components/Toast';
import { WaterEnergy } from '../components/WaterEnergy';
import { useAppLock } from '../hooks/useAppLock';
import { useToday } from '../hooks/useClock';
import { HISTORY_DAYS, LOADED_DAYS, useDailyHub } from '../hooks/useDailyHub';
import { appLockSupported, authenticate, lockAvailability } from '../lib/appLock';
import { lastNDays } from '../lib/date';
import { exportAvailable, removeOldExports, shareExport } from '../lib/exportData';
import { buildExport } from '../lib/exportJson';
import { canAddCustomHabit, canAddNote, purchasePremiumMock, type PaywallReason } from '../lib/premium';
import {
  disableDailyReminder,
  enableDailyReminder,
  hourLabel,
  isReminderScheduled,
  remindersSupported,
} from '../lib/reminders';
import { loadAllDays } from '../lib/storage';
import {
  CUSTOM_HABITS_MAX,
  getDay,
  HABIT_MAX_LENGTH,
  habitStreak,
  newId,
  totalCents,
  type Action,
  type Settings,
} from '../lib/store';
import { colors, radius, space, type } from '../theme';

const UNDO_MS = 5000;

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const today = useToday();
  const { state, dispatch, ready, loadFailed, saveFailed, encrypted } = useDailyHub(today);
  const lock = useAppLock(state.settings.lockEnabled);
  const day = getDay(state, today);

  // Export files are plain JSON; don't leave yesterday's lying in the cache.
  useEffect(() => removeOldExports(), []);

  // ---- short messages under the header ------------------------------------
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 3500);
    return () => clearTimeout(t);
  }, [message]);

  // ---- undo ---------------------------------------------------------------
  const [undo, setUndo] = useState<{ message: string; restore: Action } | null>(null);
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [undo]);

  const runUndo = () => {
    if (undo) dispatch(undo.restore);
    setUndo(null);
  };

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

  const unlockPremium = async () => {
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

  const deleteNote = (id: string) => {
    const note = day.notes.find((n) => n.id === id);
    if (!note) return;
    dispatch({ type: 'deleteNote', date: today, id });
    setUndo({ message: 'Note deleted', restore: { type: 'restoreNote', date: today, note } });
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

  const removeHabit = (id: string) => {
    const index = state.habits.findIndex((h) => h.id === id);
    const habit = state.habits[index];
    if (!habit || habit.core) return;
    const wasDone = day.habitsDone.includes(id);
    dispatch({ type: 'removeHabit', date: today, id });
    setUndo({
      message: `Removed “${habit.label}”`,
      restore: { type: 'restoreHabit', date: today, habit, index, wasDone },
    });
  };

  const streaks = useMemo(() => {
    const out: Record<string, number> = {};
    for (const h of state.habits) out[h.id] = habitStreak(state, h.id, today, LOADED_DAYS);
    return out;
  }, [state, today]);

  // ---- expenses -----------------------------------------------------------
  const deleteExpense = (id: string) => {
    const expense = day.expenses.find((e) => e.id === id);
    if (!expense) return;
    dispatch({ type: 'deleteExpense', date: today, id });
    setUndo({ message: 'Expense deleted', restore: { type: 'restoreExpense', date: today, expense } });
  };

  // ---- reminder -----------------------------------------------------------
  const [reminderOn, setReminderOn] = useState(false);
  const [reminderBusy, setReminderBusy] = useState(false);
  const reminderHour = state.settings.reminderHour;

  useEffect(() => {
    let live = true;
    isReminderScheduled().then((on) => live && setReminderOn(on));
    return () => {
      live = false;
    };
  }, []);

  const toggleReminder = async () => {
    setReminderBusy(true);
    try {
      if (reminderOn) {
        await disableDailyReminder();
        setReminderOn(false);
        setMessage('Daily reminder off.');
      } else {
        const result = await enableDailyReminder(reminderHour);
        if (result === 'enabled') {
          setReminderOn(true);
          setMessage(`We’ll nudge you at ${hourLabel(reminderHour)} each day.`);
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

  // Moving the time moves a reminder that is already on.
  const scheduledHour = useRef(reminderHour);
  useEffect(() => {
    if (!ready || scheduledHour.current === reminderHour) return;
    scheduledHour.current = reminderHour;
    if (reminderOn) void enableDailyReminder(reminderHour);
  }, [ready, reminderHour, reminderOn]);

  // ---- settings -----------------------------------------------------------
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [canExport, setCanExport] = useState(false);
  useEffect(() => {
    let live = true;
    exportAvailable().then((ok) => live && setCanExport(ok));
    return () => {
      live = false;
    };
  }, []);

  const changeSettings = useCallback((patch: Partial<Settings>) => dispatch({ type: 'updateSettings', patch }), [dispatch]);

  const toggleLock = async (next: boolean) => {
    setLockBusy(true);
    try {
      if (next && (await lockAvailability()) === 'no-device-lock') {
        setSettingsOpen(false);
        setMessage('Set a screen lock (PIN, pattern, fingerprint or face) on your phone first.');
        return;
      }
      // Turning it on or off both need the owner: the first proves the lock
      // will open for them, the second stops anyone else switching it off.
      const ok = await authenticate(next ? 'Confirm to turn on app lock' : 'Confirm to turn off app lock');
      if (!ok) return;
      if (next) lock.markUnlocked();
      changeSettings({ lockEnabled: next });
    } finally {
      setLockBusy(false);
    }
  };

  const runExport = async () => {
    setExportBusy(true);
    try {
      // Memory holds the newest copy of the days it has loaded; storage has
      // everything older.
      const days = { ...(await loadAllDays()), ...state.days };
      const { filename, json } = buildExport(days, state.habits, state.settings);
      await shareExport(filename, json);
    } catch (err) {
      console.warn('[export] failed', err);
      setSettingsOpen(false);
      setMessage('Couldn’t export your data. Please try again.');
    } finally {
      setExportBusy(false);
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

  if (lock.locked) return <LockScreen busy={lock.busy} onUnlock={lock.unlock} />;

  return (
    // iOS: the ScrollView insets itself for the keyboard. Android: edge-to-edge
    // means the window no longer resizes, so pad for the keyboard here.
    <KeyboardAvoidingView style={styles.fill} behavior="padding" enabled={Platform.OS === 'android'}>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + space.xxl + (undo ? 64 : 0) },
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
              hour: reminderHour,
              onToggle: toggleReminder,
            }}
            onSettingsPress={() => setSettingsOpen(true)}
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
            onDelete={deleteNote}
          />

          <HabitChecklist
            habits={state.habits}
            done={day.habitsDone}
            streaks={streaks}
            streakCap={LOADED_DAYS}
            isPremium={isPremium}
            composerOpen={habitComposerOpen}
            onToggle={(id) => dispatch({ type: 'toggleHabit', date: today, id })}
            onRemove={removeHabit}
            onRequestAdd={requestAddHabit}
            onCloseComposer={() => setHabitComposerOpen(false)}
            onAdd={addHabit}
          />

          <WaterEnergy
            water={day.water}
            goal={state.settings.waterGoal}
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
            onDelete={deleteExpense}
          />

          <HistoryCard
            isPremium={isPremium}
            waterGoal={state.settings.waterGoal}
            days={history}
            onUnlock={() => openPaywall('history')}
          />
        </View>
      </ScrollView>

      {undo ? <UndoToast message={undo.message} onUndo={runUndo} /> : null}

      <PaywallModal reason={paywall} onClose={closePaywall} onUnlock={unlockPremium} />

      <SettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={state.settings}
        onChange={changeSettings}
        reminderOn={reminderOn}
        lockSupported={appLockSupported}
        lockBusy={lockBusy}
        onToggleLock={toggleLock}
        exportSupported={canExport}
        exportBusy={exportBusy}
        onExport={runExport}
        encrypted={encrypted}
        version={appConfig.expo.version}
      />
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
