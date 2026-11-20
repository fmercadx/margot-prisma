import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Pressable,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import appConfig from '../../app.json';
import { CountdownsCard } from '../components/CountdownsCard';
import { DaySheet } from '../components/DaySheet';
import { ExpenseLogger } from '../components/ExpenseLogger';
import { HabitChecklist } from '../components/HabitChecklist';
import { Header } from '../components/Header';
import { HistoryCard } from '../components/HistoryCard';
import { InsightsCard } from '../components/InsightsCard';
import { Journal } from '../components/Journal';
import { LockScreen } from '../components/LockScreen';
import { MoneyVisibility } from '../components/Money';
import { PaywallModal } from '../components/PaywallModal';
import { QuickCapture } from '../components/QuickCapture';
import { SearchSheet } from '../components/SearchSheet';
import { SettingsSheet } from '../components/SettingsSheet';
import { UndoToast } from '../components/Toast';
import { TodayFocus } from '../components/TodayFocus';
import { WaterEnergy } from '../components/WaterEnergy';
import { useAppLock } from '../hooks/useAppLock';
import { useToday } from '../hooks/useClock';
import { HISTORY_DAYS, LOADED_DAYS, useDailyHub } from '../hooks/useDailyHub';
import { appLockSupported, authenticate, lockAvailability } from '../lib/appLock';
import { lastNDays, longDate, parseDateKey, weekdayName } from '../lib/date';
import { exportAvailable, removeOldExports, shareExport } from '../lib/exportData';
import { buildExpensesCsv } from '../lib/exportCsv';
import { buildExport, protectedFilename } from '../lib/exportJson';
import { openBackup, readSealedBackup, sealBackup, type SealedBackup } from '../lib/backupCrypto';
import { haptic, setHapticsEnabled } from '../lib/haptics';
import { pickBackupText } from '../lib/importData';
import { findInsights } from '../lib/insights';
import { parseBackup, type ParsedBackup } from '../lib/importJson';
import {
  canAddCustomHabit,
  canAddNote,
  FREE_NOTES_PER_DAY,
  purchasePremiumMock,
  type PaywallReason,
} from '../lib/premium';
import {
  cancelFocusEnd,
  disableDailyReminder,
  enableDailyReminder,
  hourLabel,
  isReminderScheduled,
  remindersSupported,
  scheduleFocusEnd,
} from '../lib/reminders';
import { loadAllDays } from '../lib/storage';
import {
  CUSTOM_HABITS_MAX,
  EDITABLE_DAYS,
  cleanFocus,
  focusLabel,
  focusMinutesDone,
  getDay,
  HABIT_MAX_LENGTH,
  type HomeCard,
  type DayLog,
  habitStreak,
  isScheduled,
  mergeBackup,
  newId,
  openTasksBefore,
  recentExpenses,
  STREAK_MILESTONES,
  totalCents,
  type Action,
  type MergeStats,
  type Settings,
} from '../lib/store';
import { colors, radius, space, type } from '../theme';

const UNDO_MS = 5000;

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const today = useToday();
  const { state, dispatch, ready, loadFailed, saveFailed, encrypted, erase } = useDailyHub(today);
  const lock = useAppLock(state.settings.lockEnabled, state.settings.relockAfterSec * 1000);
  // The day being logged: today, or one of the last week's days picked in
  // the header, for filling in what was forgotten. Streaks, carry-over and
  // countdowns always count from the real today.
  const [viewDate, setViewDate] = useState<string | null>(null);
  const editable = useMemo(() => lastNDays(today, EDITABLE_DAYS + 1), [today]); // oldest first; the last is today
  const activeDate = viewDate && editable.includes(viewDate) ? viewDate : today;
  const isToday = activeDate === today;
  const daysBack = editable.length - 1 - editable.indexOf(activeDate);
  const dayWord = isToday ? 'today' : daysBack === 1 ? 'yesterday' : `on ${weekdayName(parseDateKey(activeDate))}`;
  const day = getDay(state, activeDate);

  // Export files are plain JSON; don't leave yesterday's lying in the cache.
  useEffect(() => removeOldExports(), []);

  useEffect(() => setHapticsEnabled(state.settings.haptics), [state.settings.haptics]);

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
  // The mock purchase is remembered on the phone, sealed like everything else
  // and cleared by Erase everything, so it survives a restart, including
  // Android closing the app in the background. A real build would restore
  // this from the App Store / Play Store entitlement instead.
  const isPremium = state.settings.mockPremium;
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
    dispatch({ type: 'updateSettings', patch: { mockPremium: true } });
    setPaywall(null);
    const next = afterUnlock.current;
    afterUnlock.current = null;
    next?.();
  };

  // ---- quick capture ------------------------------------------------------
  const [noteDraft, setNoteDraft] = useState('');
  const [taskMode, setTaskMode] = useState(false);

  const saveNote = (text: string, date: string, task: boolean) => {
    const note = { id: newId('note'), text, createdAt: Date.now(), ...(task ? { task: true as const } : {}) };
    dispatch({ type: 'addNote', date, note });
    setNoteDraft('');
    haptic.success();
  };

  const toggleTask = (id: string) => {
    dispatch({ type: 'toggleTask', date: activeDate, id, now: Date.now() });
    haptic.tick();
  };

  // ---- unfinished to-dos from earlier days ---------------------------------
  const openTasks = useMemo(() => openTasksBefore(state, today), [state, today]);
  const [carryDismissedOn, setCarryDismissedOn] = useState<string | null>(null);
  const yesterday = lastNDays(today, 2)[0];
  const carryFrom = (() => {
    const froms = [...new Set(openTasks.map((t) => t.from))];
    if (froms.length !== 1) return 'the last few days';
    return froms[0] === yesterday ? 'yesterday' : weekdayName(parseDateKey(froms[0]));
  })();

  const doCarry = () => {
    const now = Date.now();
    dispatch({
      type: 'carryOver',
      to: today,
      // Newest first, like the rest of the list.
      items: openTasks.map(({ from, note }, i) => ({
        from,
        id: note.id,
        copy: { id: newId('note'), createdAt: now - i },
      })),
    });
    haptic.success();
    const n = openTasks.length;
    setMessage(`Brought ${n} ${n === 1 ? 'to-do' : 'to-dos'} over to today.`);
  };

  const carryOver = () => {
    if (openTasks.length === 0) return;
    // Brought-over to-dos are today's notes, so they count toward the free three.
    if (!isPremium && day.notes.length + openTasks.length > FREE_NOTES_PER_DAY) {
      openPaywall('notes', doCarry);
      return;
    }
    doCarry();
  };

  const editNote = (id: string, text: string) => {
    dispatch({ type: 'editNote', date: activeDate, id, text, now: Date.now() });
    haptic.success();
  };

  const submitNote = () => {
    const text = noteDraft.trim();
    if (!text) return;
    const task = taskMode;
    const date = activeDate;
    if (!canAddNote(day.notes.length, isPremium)) {
      // The draft stays in the box; unlocking saves it.
      openPaywall('notes', () => saveNote(text, date, task));
      return;
    }
    saveNote(text, date, task);
  };

  const deleteNote = (id: string) => {
    const note = day.notes.find((n) => n.id === id);
    if (!note) return;
    dispatch({ type: 'deleteNote', date: activeDate, id });
    haptic.remove();
    setUndo({ message: 'Note deleted', restore: { type: 'restoreNote', date: activeDate, note } });
  };

  // ---- today's focus ------------------------------------------------------
  const saveFocus = (text: string) => {
    if (cleanFocus(text) === day.focus) return;
    dispatch({ type: 'setFocus', date: activeDate, text });
    haptic.success();
  };

  // ---- search -------------------------------------------------------------
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchDays, setSearchDays] = useState<Record<string, DayLog> | null>(null);

  const openSearch = () => {
    setSearchDays(null);
    setSearchOpen(true);
    // Every stored day, decrypted on the phone. Memory has the newest copy
    // of the days it holds.
    loadAllDays()
      .then((all) => setSearchDays({ ...all, ...state.days }))
      .catch((err) => {
        console.warn('[search] could not read older days', err);
        setSearchDays({ ...state.days });
      });
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
    // Removing always unticks it today (not the day being looked at), so undo restores today's state.
    const todayLog = getDay(state, today);
    const wasDone = todayLog.habitsDone.includes(id);
    const wasSkipped = todayLog.habitsSkipped.includes(id);
    dispatch({ type: 'removeHabit', date: today, id });
    haptic.remove();
    setUndo({
      message: `Removed “${habit.label}”`,
      restore: { type: 'restoreHabit', date: today, habit, index, wasDone, wasSkipped },
    });
  };

  const skipHabit = (id: string) => {
    const habit = state.habits.find((h) => h.id === id);
    if (!habit) return;
    const skipping = !day.habitsSkipped.includes(id);
    dispatch({ type: 'skipHabit', date: activeDate, id });
    haptic.tick();
    if (skipping) setMessage(`Skipped “${habit.label}” ${dayWord}. Its streak carries on.`);
  };

  const streaks = useMemo(() => {
    const out: Record<string, number> = {};
    for (const h of state.habits) out[h.id] = habitStreak(state, h.id, today, LOADED_DAYS);
    return out;
  }, [state, today]);

  // ---- focus timer --------------------------------------------------------
  // The session lives in state (and storage), so it survives the app being
  // closed; a local notification marks the end when the app isn't open.
  const focusTimer = state.focusTimer;
  const loadedDates = useMemo(() => lastNDays(today, LOADED_DAYS), [today]);

  const startFocus = async () => {
    if (focusTimer) return;
    const now = Date.now();
    const minutes = state.settings.focusLength;
    dispatch({ type: 'startFocus', date: today, now, minutes });
    haptic.tick();
    const result = await scheduleFocusEnd(now + minutes * 60_000, minutes);
    if (result === 'denied') setMessage('Notifications are off, so the session will end quietly.');
  };

  const stopFocus = () => {
    if (!focusTimer) return;
    const done = focusMinutesDone(focusTimer, Date.now());
    dispatch({ type: 'endFocus', now: Date.now() });
    void cancelFocusEnd();
    haptic.tick();
    setMessage(done > 0 ? `Stopped early: ${focusLabel(done)} of focus kept.` : 'Focus session stopped.');
  };

  // The end: on time while open, or on the next look once the app returns.
  useEffect(() => {
    if (!ready || !focusTimer) return;
    const t = focusTimer;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      // A session from a day no longer in memory can't be added to it
      // without overwriting that day; it is let go instead.
      if (!loadedDates.includes(t.date)) {
        dispatch({ type: 'cancelFocus' });
        return;
      }
      dispatch({ type: 'endFocus', now: Date.now() });
      void cancelFocusEnd();
      haptic.success();
      setMessage(`Focus session done: ${focusLabel(focusMinutesDone(t, t.endsAt))}. Time for a short break.`);
    };
    // Checked at most half a minute apart: Android may defer long timers.
    const check = () => {
      const left = t.endsAt - Date.now();
      if (left <= 0) finish();
      else timer = setTimeout(check, Math.min(left + 50, 30_000));
    };
    check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      clearTimeout(timer);
      check();
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [ready, focusTimer, loadedDates, dispatch]);

  // ---- expenses -----------------------------------------------------------
  const recent = useMemo(() => recentExpenses(state, today), [state, today]);

  const deleteExpense = (id: string) => {
    const expense = day.expenses.find((e) => e.id === id);
    if (!expense) return;
    dispatch({ type: 'deleteExpense', date: activeDate, id });
    haptic.remove();
    setUndo({ message: 'Expense deleted', restore: { type: 'restoreExpense', date: activeDate, expense } });
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

  const changeSettings = useCallback(
    (patch: Partial<Settings>) => dispatch({ type: 'updateSettings', patch }),
    [dispatch],
  );

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

  const [exportOpen, setExportOpen] = useState(false);
  const runExport = async (passphrase: string | null) => {
    setExportBusy(true);
    try {
      // Memory holds the newest copy of the days it has loaded; storage has
      // everything older.
      const days = { ...(await loadAllDays()), ...state.days };
      const { filename, json } = buildExport(days, state.habits, state.settings, undefined, state.countdowns);
      if (passphrase) await shareExport(protectedFilename(filename), await sealBackup(json, passphrase));
      else await shareExport(filename, json);
      setExportOpen(false);
    } catch (err) {
      console.warn('[export] failed', err);
      setSettingsOpen(false);
      setMessage('Couldn’t export your data. Please try again.');
    } finally {
      setExportBusy(false);
    }
  };

  const [csvBusy, setCsvBusy] = useState(false);
  const runCsvExport = async () => {
    setCsvBusy(true);
    try {
      const { filename, csv, rows } = buildExpensesCsv({ ...(await loadAllDays()), ...state.days });
      if (rows === 0) {
        setSettingsOpen(false);
        setMessage('There are no expenses to export yet.');
        return;
      }
      await shareExport(filename, csv, 'csv');
    } catch (err) {
      console.warn('[export] csv failed', err);
      setSettingsOpen(false);
      setMessage('Couldn’t export your expenses. Please try again.');
    } finally {
      setCsvBusy(false);
    }
  };

  // ---- restore ------------------------------------------------------------
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restorePending, setRestorePending] = useState<{ backup: ParsedBackup; stats: MergeStats } | null>(null);
  // A protected backup waiting for its passphrase.
  const [restoreLocked, setRestoreLocked] = useState<SealedBackup | null>(null);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  /** Checks a backup's contents and shows what restoring would add. */
  const previewBackup = (text: string) => {
    const parsed = parseBackup(text);
    if (!parsed.ok) {
      setSettingsOpen(false);
      setMessage(parsed.error);
      return;
    }
    const { stats } = mergeBackup(state, parsed.backup.habits, parsed.backup.days, parsed.backup.countdowns);
    if (Object.values(stats).every((n) => n === 0)) {
      setSettingsOpen(false);
      setMessage('Everything in that backup is already on this phone.');
      return;
    }
    setRestorePending({ backup: parsed.backup, stats });
  };

  const unlockRestore = async (passphrase: string) => {
    if (!restoreLocked) return;
    setRestoreBusy(true);
    setUnlockError(null);
    try {
      const opened = await openBackup(restoreLocked, passphrase);
      if (!opened.ok) {
        setUnlockError('That passphrase doesn’t open this backup.');
        return;
      }
      setRestoreLocked(null);
      previewBackup(opened.json);
    } finally {
      setRestoreBusy(false);
    }
  };

  const startRestore = async () => {
    setRestoreBusy(true);
    try {
      const picked = await pickBackupText();
      if (picked.kind === 'canceled') return;
      if (picked.kind === 'error') {
        setSettingsOpen(false);
        setMessage(picked.message);
        return;
      }
      const sealed = readSealedBackup(picked.text);
      if (sealed === 'unsupported') {
        setSettingsOpen(false);
        setMessage('That protected backup uses settings this app won’t open.');
        return;
      }
      if (sealed) {
        setUnlockError(null);
        setRestoreLocked(sealed);
        return;
      }
      previewBackup(picked.text);
    } catch (err) {
      console.warn('[restore] failed', err);
      setSettingsOpen(false);
      setMessage('Couldn’t restore that backup. Please try again.');
    } finally {
      setRestoreBusy(false);
    }
  };

  const confirmRestore = () => {
    if (!restorePending) return;
    const { backup, stats } = restorePending;
    dispatch({ type: 'importBackup', habits: backup.habits, days: backup.days, countdowns: backup.countdowns });
    setRestorePending(null);
    setSettingsOpen(false);
    haptic.success();
    const days = stats.daysAdded + stats.daysMerged;
    setMessage(`Restored ${days} ${days === 1 ? 'day' : 'days'} from your backup.`);
  };

  // ---- countdowns and insights --------------------------------------------
  const addCountdown = (label: string, date: string) => {
    dispatch({ type: 'addCountdown', countdown: { id: newId('cd'), label, date } });
    haptic.success();
  };
  const removeCountdown = (id: string) => {
    const countdown = state.countdowns.find((c) => c.id === id);
    if (!countdown) return;
    dispatch({ type: 'removeCountdown', id });
    haptic.remove();
    setUndo({ message: `Removed “${countdown.label}”`, restore: { type: 'addCountdown', countdown } });
  };
  // Only worked out for Premium, who can see them.
  const insights = useMemo(
    () => (isPremium ? findInsights(state.days, state.habits, state.settings.waterGoal) : []),
    [isPremium, state.days, state.habits, state.settings.waterGoal],
  );

  // ---- erase everything ---------------------------------------------------
  const [eraseConfirming, setEraseConfirming] = useState(false);
  const [eraseBusy, setEraseBusy] = useState(false);

  const eraseEverything = async () => {
    setEraseBusy(true);
    try {
      // With the app lock on, only the owner can wipe it.
      if (state.settings.lockEnabled && !(await authenticate('Confirm to erase all data'))) return;
      // The reminder goes first, so resetting the reminder time can't
      // reschedule it.
      await disableDailyReminder();
      await cancelFocusEnd();
      setReminderOn(false);
      await erase();
      removeOldExports();
      setUndo(null);
      setNoteDraft('');
      setRestorePending(null);
      setHabitComposerOpen(false);
      setOpenDay(null);
      setEraseConfirming(false);
      setSettingsOpen(false);
      setMessage('Everything on this phone has been erased.');
    } catch (err) {
      console.warn('[erase] failed', err);
      setEraseConfirming(false);
      setSettingsOpen(false);
      setMessage('Couldn’t erase everything. Please try again.');
    } finally {
      setEraseBusy(false);
    }
  };

  // ---- day details --------------------------------------------------------
  const [openDay, setOpenDay] = useState<string | null>(null);
  const openIndex = openDay ? loadedDates.indexOf(openDay) : -1;

  // ---- layout -------------------------------------------------------------
  const [scrollEnabled, setScrollEnabled] = useState(true);

  const history = useMemo(
    () => lastNDays(today, HISTORY_DAYS).map((date) => ({ date, log: state.days[date] ?? null })),
    [today, state.days],
  );

  // ---- the cards, in the order chosen in Settings ---------------------------
  const cards: Record<HomeCard, ReactNode> = {
    focus: (
      <TodayFocus
        key={`focus-${activeDate}`}
        focus={day.focus}
        onSave={saveFocus}
        dayWord={dayWord}
        focusMinutes={day.focusMinutes}
        timer={
          isToday
            ? {
                running: focusTimer,
                length: state.settings.focusLength,
                onStart: () => void startFocus(),
                onStop: stopFocus,
              }
            : undefined
        }
      />
    ),
    notes: (
      <QuickCapture
        notes={day.notes}
        isPremium={isPremium}
        draft={noteDraft}
        onDraftChange={setNoteDraft}
        onSubmit={submitNote}
        onDelete={deleteNote}
        onEdit={editNote}
        onSearch={openSearch}
        taskMode={taskMode}
        onTaskModeChange={setTaskMode}
        onToggleTask={toggleTask}
        carry={
          isToday && openTasks.length > 0 && carryDismissedOn !== today
            ? { count: openTasks.length, from: carryFrom }
            : null
        }
        dayWord={dayWord}
        onCarry={carryOver}
        onDismissCarry={() => setCarryDismissedOn(today)}
      />
    ),
    habits: (
      <HabitChecklist
        habits={state.habits}
        done={day.habitsDone}
        skipped={day.habitsSkipped}
        onSkip={skipHabit}
        onMove={(id, nextTo, where) => {
          dispatch({ type: 'moveHabit', id, nextTo, where });
          haptic.tick();
        }}
        streaks={isToday ? streaks : {}}
        streakCap={LOADED_DAYS}
        isPremium={isPremium}
        composerOpen={habitComposerOpen}
        onToggle={(id) => {
          const ticking = !day.habitsDone.includes(id);
          dispatch({ type: 'toggleHabit', date: activeDate, id });
          // Not ticked yet today, the streak counts up to yesterday; this tick adds today.
          const reached = (streaks[id] ?? 0) + 1;
          const habit = state.habits.find((h) => h.id === id);
          // A tick on a day off doesn't add to the streak, so it is no milestone.
          if (isToday && ticking && habit && isScheduled(habit, today) && STREAK_MILESTONES.includes(reached)) {
            haptic.success();
            setMessage(`${reached}-day streak on “${habit.label}”. Keep it going!`);
          } else {
            haptic.tick();
          }
        }}
        onRemove={removeHabit}
        onRequestAdd={requestAddHabit}
        onCloseComposer={() => setHabitComposerOpen(false)}
        onAdd={addHabit}
        today={activeDate}
        isToday={isToday}
        onSetDays={(id, days) => dispatch({ type: 'setHabitDays', id, days })}
        onRename={(id, raw) => {
          const label = raw.trim().slice(0, HABIT_MAX_LENGTH);
          if (!label) return 'Give the habit a name.';
          if (state.habits.some((h) => h.id !== id && h.label.toLowerCase() === label.toLowerCase())) {
            return 'You already have that habit.';
          }
          dispatch({ type: 'renameHabit', id, label });
          return null;
        }}
      />
    ),
    wellbeing: (
      <WaterEnergy
        water={day.water}
        showPace={isToday}
        goal={state.settings.waterGoal}
        energy={day.energy}
        onAdjustWater={(delta) => {
          dispatch({ type: 'adjustWater', date: activeDate, delta });
          haptic.tick();
        }}
        onSetEnergy={(value) => {
          dispatch({ type: 'setEnergy', date: activeDate, value });
          haptic.tick();
        }}
        onDragStateChange={(dragging) => setScrollEnabled(!dragging)}
        mood={day.mood}
        onSetMood={(value) => {
          dispatch({ type: 'setMood', date: activeDate, value });
          haptic.tick();
        }}
        sleep={day.sleep}
        onSetSleep={(value) => {
          dispatch({ type: 'setSleep', date: activeDate, value });
          haptic.tick();
        }}
      />
    ),
    expenses: (
      <ExpenseLogger
        expenses={day.expenses}
        totalCents={totalCents(day)}
        budgetCents={state.settings.dailyBudgetCents}
        onAdd={(cents, label, category) => {
          dispatch({
            type: 'addExpense',
            date: activeDate,
            expense: { id: newId('exp'), cents, label, category, createdAt: Date.now() },
          });
          haptic.success();
        }}
        onDelete={deleteExpense}
        dayWord={dayWord}
        recent={recent}
        onRepeat={(e) => {
          dispatch({
            type: 'addExpense',
            date: activeDate,
            expense: { id: newId('exp'), cents: e.cents, label: e.label, category: e.category, createdAt: Date.now() },
          });
          haptic.success();
        }}
        hidden={state.settings.hideAmounts}
        onToggleHidden={() => changeSettings({ hideAmounts: !state.settings.hideAmounts })}
      />
    ),
    journal: (
      <Journal
        key={`journal-${activeDate}`}
        date={activeDate}
        entry={day.journal}
        onSave={(text) => {
          dispatch({ type: 'setJournal', date: activeDate, text });
          haptic.success();
        }}
      />
    ),
    countdowns: (
      <CountdownsCard countdowns={state.countdowns} today={today} onAdd={addCountdown} onRemove={removeCountdown} />
    ),
    insights: <InsightsCard isPremium={isPremium} insights={insights} onUnlock={() => openPaywall('history')} />,
    history: (
      <HistoryCard
        isPremium={isPremium}
        waterGoal={state.settings.waterGoal}
        habits={state.habits}
        days={history}
        allDays={state.days}
        firstLoaded={loadedDates[0]}
        onUnlock={() => openPaywall('history')}
        onOpenDay={setOpenDay}
      />
    ),
  };
  const hiddenCards = state.settings.homeHidden;
  const visibleCards = state.settings.homeOrder.filter((id) => !hiddenCards.includes(id));

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
    <MoneyVisibility value={state.settings.hideAmounts}>
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
              logging={{
                label:
                  daysBack === 1
                    ? 'yesterday'
                    : daysBack === EDITABLE_DAYS
                      ? `last ${weekdayName(parseDateKey(activeDate))}`
                      : weekdayName(parseDateKey(activeDate)),
                fullDate: `${weekdayName(parseDateKey(activeDate))}, ${longDate(parseDateKey(activeDate))}`,
                isToday,
                canBack: daysBack < EDITABLE_DAYS,
                onBack: () => setViewDate(editable[editable.indexOf(activeDate) - 1]),
                onForward: () => {
                  const next = editable[editable.indexOf(activeDate) + 1];
                  setViewDate(next === today ? null : next);
                },
                onToday: () => setViewDate(null),
              }}
            />

            {loadFailed ? (
              <Banner text="Couldn’t read your saved data. To keep it safe, changes made now won’t be saved." />
            ) : saveFailed ? (
              <Banner text="Changes aren’t being saved right now. We’ll keep trying." />
            ) : null}

            {visibleCards.length === 0 ? <AllHidden onOpenSettings={() => setSettingsOpen(true)} /> : null}
            {visibleCards.map((id) => (
              <Fragment key={id}>{cards[id]}</Fragment>
            ))}
          </View>
        </ScrollView>

        {undo ? <UndoToast message={undo.message} onUndo={runUndo} /> : null}

        <PaywallModal reason={paywall} onClose={closePaywall} onUnlock={unlockPremium} />

        <SettingsSheet
          visible={settingsOpen}
          onClose={() => {
            setSettingsOpen(false);
            setRestorePending(null);
            setRestoreLocked(null);
            setExportOpen(false);
            setEraseConfirming(false);
          }}
          settings={state.settings}
          onChange={changeSettings}
          reminderOn={reminderOn}
          lockSupported={appLockSupported}
          lockBusy={lockBusy}
          onToggleLock={toggleLock}
          exportSupported={canExport}
          exportBusy={exportBusy}
          onExport={runExport}
          exportOpen={exportOpen}
          onOpenExport={() => setExportOpen(true)}
          onCloseExport={() => setExportOpen(false)}
          csvBusy={csvBusy}
          onExportCsv={runCsvExport}
          encrypted={encrypted}
          version={appConfig.expo.version}
          hapticsSupported={Platform.OS !== 'web'}
          restoreBusy={restoreBusy}
          onRestore={startRestore}
          restorePreview={
            restorePending ? { stats: restorePending.stats, exportedAt: restorePending.backup.exportedAt } : null
          }
          onConfirmRestore={confirmRestore}
          onCancelRestore={() => {
            setRestorePending(null);
            setRestoreLocked(null);
          }}
          restoreLocked={restoreLocked !== null}
          restoreUnlockError={unlockError}
          onUnlockRestore={unlockRestore}
          eraseConfirming={eraseConfirming}
          eraseBusy={eraseBusy}
          onRequestErase={() => setEraseConfirming(true)}
          onConfirmErase={eraseEverything}
          onCancelErase={() => setEraseConfirming(false)}
        />

        <SearchSheet visible={searchOpen} days={searchDays} today={today} onClose={() => setSearchOpen(false)} />

        <DaySheet
          date={openDay}
          isToday={openDay === today}
          log={openDay ? (state.days[openDay] ?? null) : null}
          habits={state.habits}
          waterGoal={state.settings.waterGoal}
          canPrev={openIndex > 0}
          canNext={openIndex >= 0 && openIndex < loadedDates.length - 1}
          onPrev={() => openIndex > 0 && setOpenDay(loadedDates[openIndex - 1])}
          onNext={() => openIndex < loadedDates.length - 1 && setOpenDay(loadedDates[openIndex + 1])}
          onClose={() => setOpenDay(null)}
          onShare={(text) => {
            // The person picks where it goes; nothing is sent by the app itself.
            Share.share({ message: text }).catch((err) => console.warn('[share] failed', err));
          }}
        />
      </KeyboardAvoidingView>
    </MoneyVisibility>
  );
}

/** Every card switched off: say so, and where to bring them back. */
function AllHidden({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <View style={styles.allHidden} testID="all-hidden">
      <Text style={styles.allHiddenText}>Every card is switched off.</Text>
      <Pressable
        onPress={onOpenSettings}
        accessibilityRole="button"
        accessibilityLabel="Choose cards in Settings"
        style={({ pressed }) => [styles.allHiddenButton, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.allHiddenButtonText}>Choose cards in Settings</Text>
      </Pressable>
    </View>
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
  allHidden: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.xl,
    alignItems: 'center',
    gap: space.md,
  },
  allHiddenText: { ...type.body, color: colors.textSecondary },
  allHiddenButton: {
    minHeight: 44,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.cardRaised,
    justifyContent: 'center',
  },
  allHiddenButtonText: { ...type.label, color: colors.text, fontWeight: '700' },
});
