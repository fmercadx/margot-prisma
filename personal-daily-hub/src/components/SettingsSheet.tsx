import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  FileDown,
  FileSpreadsheet,
  FileUp,
  KeyRound,
  Minus,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from '../icons';
import { PASSPHRASE_MIN_LENGTH } from '../lib/backupCrypto';
import {
  CATEGORY_BUDGET_STEPS_CENTS,
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  MONTHLY_BUDGET_STEPS_CENTS,
  stepBudget,
} from '../lib/categories';
import { formatCents } from '../lib/money';
import { PREMIUM_INCLUDED } from '../lib/premium';
import { hourLabel, minutesLabel } from '../lib/reminders';
import { ordinal, type Bill, type MergeStats } from '../lib/store';
import {
  FOCUS_LENGTHS,
  HOME_CARDS,
  RELOCK_CHOICES_SEC,
  REMINDER_HOUR_MAX,
  REMINDER_HOUR_MIN,
  WATER_GOAL_MAX,
  WATER_GOAL_MIN,
  WIND_DOWN_CHOICES,
  type HomeCard,
  type Settings,
} from '../lib/store';
import { colors, inputColors, radius, space, type } from '../theme';
import { HOME_CARD_LABELS } from './homeCards';
import { IconButton } from './IconButton';
import { useMoney } from './Money';

const SWITCH_COLORS = {
  trackColor: { false: colors.hairline, true: colors.notes },
  thumbColor: colors.text,
  // react-native-web colours the "on" thumb with its own prop (teal by default).
  ...(Platform.OS === 'web' ? { activeThumbColor: colors.text } : {}),
};

type Props = {
  visible: boolean;
  onClose: () => void;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  reminderOn: boolean;
  /** Monthly bills, to change the day of or remove. */
  bills: Bill[];
  onSetBillDay: (id: string, day: number) => void;
  onRemoveBill: (id: string) => void;
  /** Water reminders need local notifications, which the web build lacks. */
  waterReminders: { supported: boolean; busy: boolean; onToggle: (next: boolean) => void };
  /** The wind-down reminder, the same way. */
  windDown: { supported: boolean; busy: boolean; onToggle: (next: boolean) => void };
  lockSupported: boolean;
  lockBusy: boolean;
  onToggleLock: (next: boolean) => void;
  exportSupported: boolean;
  exportBusy: boolean;
  /** The export choices (passphrase or plain) are showing. */
  exportOpen: boolean;
  onOpenExport: () => void;
  onCloseExport: () => void;
  /** null exports plain JSON. */
  onExport: (passphrase: string | null) => void;
  csvBusy: boolean;
  onExportCsv: () => void;
  encrypted: boolean;
  version: string;
  hapticsSupported: boolean;
  restoreBusy: boolean;
  onRestore: () => void;
  /** What a picked backup would add, waiting for the person to confirm. */
  restorePreview: { stats: MergeStats; exportedAt: string | null } | null;
  onConfirmRestore: () => void;
  onCancelRestore: () => void;
  /** A protected backup was picked and needs its passphrase. */
  restoreLocked: boolean;
  restoreUnlockError: string | null;
  onUnlockRestore: (passphrase: string) => void;
  /** Showing the "are you sure" step for erasing everything. */
  eraseConfirming: boolean;
  eraseBusy: boolean;
  onRequestErase: () => void;
  onConfirmErase: () => void;
  onCancelErase: () => void;
};

export function SettingsSheet(p: Props) {
  const insets = useSafeAreaInsets();
  const s = p.settings;
  const [arranging, setArranging] = useState(false);
  // The sheet stays mounted while hidden; open it fresh each time.
  useEffect(() => {
    if (!p.visible) setArranging(false);
  }, [p.visible]);

  return (
    <Modal
      visible={p.visible}
      transparent
      animationType="slide"
      onRequestClose={p.onClose}
      statusBarTranslucent={Platform.OS === 'android'}
      navigationBarTranslucent={Platform.OS === 'android'}
    >
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={p.onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss settings"
        />
        <View
          style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}
          accessibilityViewIsModal
          testID="settings"
        >
          <View style={styles.head}>
            <Text style={styles.title} accessibilityRole="header">
              Settings
            </Text>
            <IconButton icon={X} label="Close settings" onPress={p.onClose} filled />
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <Section title="Daily">
              <Row title="Water goal" subtitle="Glasses a day">
                <Stepper
                  value={`${s.waterGoal}`}
                  label="water goal"
                  onDown={() => p.onChange({ waterGoal: s.waterGoal - 1 })}
                  onUp={() => p.onChange({ waterGoal: s.waterGoal + 1 })}
                  canDown={s.waterGoal > WATER_GOAL_MIN}
                  canUp={s.waterGoal < WATER_GOAL_MAX}
                  testID="water-goal"
                />
              </Row>
              <Row title="Reminder time" subtitle={p.reminderOn ? 'Daily reminder is on' : 'Turn it on with the bell'}>
                <Stepper
                  value={hourLabel(s.reminderHour)}
                  label="reminder time"
                  onDown={() => p.onChange({ reminderHour: s.reminderHour - 1 })}
                  onUp={() => p.onChange({ reminderHour: s.reminderHour + 1 })}
                  canDown={s.reminderHour > REMINDER_HOUR_MIN}
                  canUp={s.reminderHour < REMINDER_HOUR_MAX}
                  testID="reminder-hour"
                />
              </Row>
              <Row
                title="Daily budget"
                subtitle={s.dailyBudgetCents === null ? 'Off' : 'Shows what’s left in Expenses'}
              >
                <Stepper
                  value={s.dailyBudgetCents === null ? 'Off' : formatCents(s.dailyBudgetCents).replace(/\.00$/, '')}
                  label="daily budget"
                  onDown={() => p.onChange({ dailyBudgetCents: stepBudget(s.dailyBudgetCents, -1) })}
                  onUp={() => p.onChange({ dailyBudgetCents: stepBudget(s.dailyBudgetCents, 1) })}
                  canDown={s.dailyBudgetCents !== null}
                  canUp={stepBudget(s.dailyBudgetCents, 1) !== s.dailyBudgetCents}
                  testID="daily-budget"
                />
              </Row>
              <Row
                title="Monthly budget"
                subtitle={
                  s.monthlyBudgetCents === null ? 'Off' : 'Shows the month so far, and what each day left can take'
                }
              >
                <Stepper
                  value={s.monthlyBudgetCents === null ? 'Off' : formatCents(s.monthlyBudgetCents).replace(/\.00$/, '')}
                  label="monthly budget"
                  onDown={() =>
                    p.onChange({ monthlyBudgetCents: stepBudget(s.monthlyBudgetCents, -1, MONTHLY_BUDGET_STEPS_CENTS) })
                  }
                  onUp={() =>
                    p.onChange({ monthlyBudgetCents: stepBudget(s.monthlyBudgetCents, 1, MONTHLY_BUDGET_STEPS_CENTS) })
                  }
                  canDown={s.monthlyBudgetCents !== null}
                  canUp={stepBudget(s.monthlyBudgetCents, 1, MONTHLY_BUDGET_STEPS_CENTS) !== s.monthlyBudgetCents}
                  testID="monthly-budget"
                />
              </Row>
              {p.waterReminders.supported ? (
                <Row title="Water reminders" subtitle="Every two hours, 10 AM to 6 PM, until you reach your goal">
                  {p.waterReminders.busy ? (
                    <ActivityIndicator color={colors.textSecondary} />
                  ) : (
                    <Switch
                      value={s.waterReminders}
                      onValueChange={p.waterReminders.onToggle}
                      {...SWITCH_COLORS}
                      accessibilityLabel="Water reminders"
                      testID="water-reminders-switch"
                    />
                  )}
                </Row>
              ) : null}
              {p.windDown.supported ? (
                <Row title="Wind-down reminder" subtitle="A nudge each evening to start getting ready for bed">
                  {p.windDown.busy ? (
                    <ActivityIndicator color={colors.textSecondary} />
                  ) : (
                    <Switch
                      value={s.windDownAt !== null}
                      onValueChange={p.windDown.onToggle}
                      {...SWITCH_COLORS}
                      accessibilityLabel="Wind-down reminder"
                      testID="wind-down-switch"
                    />
                  )}
                </Row>
              ) : null}
              {p.windDown.supported && s.windDownAt !== null ? (
                <Row title="Wind down at" subtitle="Every evening">
                  <Stepper
                    value={minutesLabel(s.windDownAt)}
                    label="wind-down time"
                    onDown={() => p.onChange({ windDownAt: stepChoice(WIND_DOWN_CHOICES, s.windDownAt!, -1) })}
                    onUp={() => p.onChange({ windDownAt: stepChoice(WIND_DOWN_CHOICES, s.windDownAt!, 1) })}
                    canDown={stepChoice(WIND_DOWN_CHOICES, s.windDownAt, -1) !== s.windDownAt}
                    canUp={stepChoice(WIND_DOWN_CHOICES, s.windDownAt, 1) !== s.windDownAt}
                    testID="wind-down-time"
                  />
                </Row>
              ) : null}
              <Row title="Focus session" subtitle="Length of one session on the focus timer">
                <Stepper
                  value={`${s.focusLength} min`}
                  label="focus session length"
                  onDown={() => p.onChange({ focusLength: stepChoice(FOCUS_LENGTHS, s.focusLength, -1) })}
                  onUp={() => p.onChange({ focusLength: stepChoice(FOCUS_LENGTHS, s.focusLength, 1) })}
                  canDown={stepChoice(FOCUS_LENGTHS, s.focusLength, -1) !== s.focusLength}
                  canUp={stepChoice(FOCUS_LENGTHS, s.focusLength, 1) !== s.focusLength}
                  testID="focus-length"
                />
              </Row>
              {p.hapticsSupported ? (
                <Row title="Haptic feedback" subtitle="A light tap when you tick, step or save">
                  <Switch
                    value={s.haptics}
                    onValueChange={(haptics) => p.onChange({ haptics })}
                    {...SWITCH_COLORS}
                    accessibilityLabel="Haptic feedback"
                    testID="haptics-switch"
                  />
                </Row>
              ) : null}
            </Section>

            <Section title="Budgets by category">
              {EXPENSE_CATEGORIES.map((c) => {
                const cents = s.categoryBudgets[c] ?? null;
                const label = CATEGORY_LABELS[c];
                return (
                  <Row key={c} title={label} subtitle={cents === null ? 'No limit' : 'A month'}>
                    <Stepper
                      value={cents === null ? 'Off' : formatCents(cents).replace(/\.00$/, '')}
                      label={`${label} budget`}
                      onDown={() =>
                        p.onChange({
                          categoryBudgets: { ...s.categoryBudgets, [c]: stepBudget(cents, -1, CATEGORY_BUDGET_STEPS_CENTS) },
                        })
                      }
                      onUp={() =>
                        p.onChange({
                          categoryBudgets: { ...s.categoryBudgets, [c]: stepBudget(cents, 1, CATEGORY_BUDGET_STEPS_CENTS) },
                        })
                      }
                      canDown={cents !== null}
                      canUp={stepBudget(cents, 1, CATEGORY_BUDGET_STEPS_CENTS) !== cents}
                      testID={`category-budget-${c}`}
                    />
                  </Row>
                );
              })}
            </Section>

            {s.mockPremium && !PREMIUM_INCLUDED ? (
              <Section title="Premium">
                <Pressable
                  onPress={() => p.onChange({ mockPremium: false })}
                  accessibilityRole="button"
                  accessibilityLabel="Turn off Premium"
                  accessibilityHint="Goes back to the free version, to try it again. Your data stays."
                  style={({ pressed }) => [styles.exportRow, styles.lastRow, pressed && { opacity: 0.7 }]}
                  testID="premium-off"
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>Premium is on</Text>
                    <Text style={styles.rowSubtitle}>
                      Unlocked with the test purchase: no money moved. Turn it off to try the free version again; your
                      data stays.
                    </Text>
                  </View>
                  <Text style={styles.turnOff}>Turn off</Text>
                </Pressable>
              </Section>
            ) : null}

            {p.bills.length > 0 ? (
              <Section title="Monthly bills">
                {p.bills.map((b, i) => (
                  <BillRow
                    key={b.id}
                    bill={b}
                    last={i === p.bills.length - 1}
                    onSetDay={(day) => p.onSetBillDay(b.id, day)}
                    onRemove={() => p.onRemoveBill(b.id)}
                  />
                ))}
              </Section>
            ) : null}

            <Section title="Home screen">
              {arranging ? (
                <ArrangePanel
                  order={s.homeOrder}
                  hidden={s.homeHidden}
                  onChange={p.onChange}
                  onDone={() => setArranging(false)}
                />
              ) : (
                <Pressable
                  onPress={() => setArranging(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Arrange the home screen"
                  accessibilityHint="Choose which cards show, and in what order"
                  style={({ pressed }) => [styles.exportRow, styles.lastRow, pressed && { opacity: 0.7 }]}
                  testID="arrange-home"
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>Arrange cards</Text>
                    <Text style={styles.rowSubtitle}>
                      {s.homeHidden.length === 0
                        ? 'Every card is showing. Choose which ones and their order.'
                        : `${HOME_CARDS.length - s.homeHidden.length} of ${HOME_CARDS.length} cards showing.`}
                    </Text>
                  </View>
                  <ChevronRight size={20} color={colors.textSecondary} />
                </Pressable>
              )}
            </Section>

            <Section title="Privacy & security">
              {p.lockSupported ? (
                <Row
                  title="App lock"
                  subtitle="Ask for your fingerprint, face or phone PIN. Also hides the app in recent apps and blocks screenshots."
                >
                  {p.lockBusy ? (
                    <ActivityIndicator color={colors.textSecondary} />
                  ) : (
                    <Switch
                      value={s.lockEnabled}
                      onValueChange={p.onToggleLock}
                      {...SWITCH_COLORS}
                      accessibilityLabel="App lock"
                      testID="lock-switch"
                    />
                  )}
                </Row>
              ) : null}

              {p.lockSupported && s.lockEnabled ? (
                <Row
                  title="Lock again after"
                  subtitle={
                    s.relockAfterSec === 0
                      ? 'Every time you leave the app, even for the share sheet'
                      : 'Time away from the app before it asks again'
                  }
                >
                  <Stepper
                    value={relockLabel(s.relockAfterSec)}
                    label="time before locking again"
                    onDown={() => p.onChange({ relockAfterSec: stepRelock(s.relockAfterSec, -1) })}
                    onUp={() => p.onChange({ relockAfterSec: stepRelock(s.relockAfterSec, 1) })}
                    canDown={stepRelock(s.relockAfterSec, -1) !== s.relockAfterSec}
                    canUp={stepRelock(s.relockAfterSec, 1) !== s.relockAfterSec}
                    testID="relock"
                  />
                </Row>
              ) : null}

              {p.exportSupported ? (
                p.exportOpen ? (
                  <ExportPanel busy={p.exportBusy} onExport={p.onExport} onCancel={p.onCloseExport} />
                ) : (
                  <Pressable
                    onPress={p.onOpenExport}
                    accessibilityRole="button"
                    accessibilityLabel="Export my data"
                    accessibilityHint="Saves everything as a file you choose where to send, protected with a passphrase if you like."
                    style={({ pressed }) => [styles.exportRow, pressed && { opacity: 0.7 }]}
                    testID="export"
                  >
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle}>Export my data</Text>
                      <Text style={styles.rowSubtitle}>
                        A file of everything you have logged, sent where you choose. Protect it with a passphrase, or
                        keep it as plain JSON.
                      </Text>
                    </View>
                    <FileDown size={20} color={colors.textSecondary} />
                  </Pressable>
                )
              ) : null}

              {p.exportSupported ? (
                <Pressable
                  onPress={p.onExportCsv}
                  disabled={p.csvBusy}
                  accessibilityRole="button"
                  accessibilityLabel="Export expenses as a spreadsheet"
                  accessibilityHint="Saves every expense as a CSV file you choose where to send. The file is not encrypted."
                  style={({ pressed }) => [styles.exportRow, pressed && { opacity: 0.7 }]}
                  testID="export-csv"
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>Export expenses (CSV)</Text>
                    <Text style={styles.rowSubtitle}>
                      Every expense as a spreadsheet: date, time, amount, category and label. Not encrypted.
                    </Text>
                  </View>
                  {p.csvBusy ? (
                    <ActivityIndicator color={colors.textSecondary} />
                  ) : (
                    <FileSpreadsheet size={20} color={colors.textSecondary} />
                  )}
                </Pressable>
              ) : null}

              {p.restorePreview ? (
                <RestorePreview {...p.restorePreview} onConfirm={p.onConfirmRestore} onCancel={p.onCancelRestore} />
              ) : p.restoreLocked ? (
                <UnlockPanel
                  busy={p.restoreBusy}
                  error={p.restoreUnlockError}
                  onUnlock={p.onUnlockRestore}
                  onCancel={p.onCancelRestore}
                />
              ) : (
                <Pressable
                  onPress={p.onRestore}
                  disabled={p.restoreBusy}
                  accessibilityRole="button"
                  accessibilityLabel="Restore from a backup"
                  accessibilityHint="Adds what is in an exported file to this phone. Nothing here is replaced."
                  style={({ pressed }) => [styles.exportRow, pressed && { opacity: 0.7 }]}
                  testID="restore"
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>Restore from a backup</Text>
                    <Text style={styles.rowSubtitle}>
                      Adds what is in an exported file to this phone. Nothing already here is replaced.
                    </Text>
                  </View>
                  {p.restoreBusy ? (
                    <ActivityIndicator color={colors.textSecondary} />
                  ) : (
                    <FileUp size={20} color={colors.textSecondary} />
                  )}
                </Pressable>
              )}

              {p.eraseConfirming ? (
                <View style={styles.preview} testID="erase-confirm-panel" accessibilityLiveRegion="polite">
                  <Text style={styles.rowTitle}>Erase everything?</Text>
                  <Text style={styles.previewText}>
                    {p.encrypted
                      ? 'Every day, habit and setting on this phone is deleted, and the encryption key is destroyed, so not even an old copy of the app’s data could be read again. This can’t be undone.'
                      : 'Every day, habit and setting stored here is deleted. This can’t be undone.'}
                  </Text>
                  {p.exportSupported ? (
                    <Text style={styles.rowSubtitle}>Export first if you want to keep a copy.</Text>
                  ) : null}
                  <View style={styles.previewButtons}>
                    <Pressable
                      onPress={p.onCancelErase}
                      disabled={p.eraseBusy}
                      accessibilityRole="button"
                      accessibilityLabel="Keep my data"
                      style={({ pressed }) => [styles.previewButton, pressed && { opacity: 0.7 }]}
                    >
                      <Text style={styles.previewCancel}>Keep my data</Text>
                    </Pressable>
                    <Pressable
                      onPress={p.onConfirmErase}
                      disabled={p.eraseBusy}
                      accessibilityRole="button"
                      accessibilityLabel="Erase everything"
                      style={({ pressed }) => [styles.previewButton, styles.eraseButton, pressed && { opacity: 0.85 }]}
                      testID="erase-confirm"
                    >
                      {p.eraseBusy ? (
                        <ActivityIndicator color={colors.background} />
                      ) : (
                        <Text style={styles.previewConfirmText}>Erase everything</Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable
                  onPress={p.onRequestErase}
                  accessibilityRole="button"
                  accessibilityLabel="Erase all data"
                  accessibilityHint="Asks you to confirm before anything is deleted."
                  style={({ pressed }) => [styles.exportRow, pressed && { opacity: 0.7 }]}
                  testID="erase"
                >
                  <View style={styles.rowText}>
                    <Text style={[styles.rowTitle, styles.danger]}>Erase all data</Text>
                    <Text style={styles.rowSubtitle}>Delete everything on this phone and start fresh.</Text>
                  </View>
                  <Trash2 size={20} color={colors.danger} />
                </Pressable>
              )}

              <View style={styles.privacy}>
                <ShieldCheck size={18} color={colors.habits} />
                <Text style={styles.privacyText} testID="privacy-statement">
                  {p.encrypted
                    ? 'Stored encrypted on this phone. Nothing is sent anywhere.'
                    : 'Stored only on this device. Nothing is sent anywhere.'}
                </Text>
              </View>
            </Section>

            <Text style={styles.version}>Personal Daily Hub {p.version}</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Export with a passphrase (the file is encrypted) or without (plain JSON). */
function ExportPanel(props: { busy: boolean; onExport: (passphrase: string | null) => void; onCancel: () => void }) {
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const longEnough = pass.length >= PASSPHRASE_MIN_LENGTH;
  const matches = pass === confirm;
  const canProtect = longEnough && matches && !props.busy;
  const hint = !pass
    ? `At least ${PASSPHRASE_MIN_LENGTH} characters. A forgotten passphrase can't be recovered.`
    : !longEnough
      ? `${PASSPHRASE_MIN_LENGTH - pass.length} more ${PASSPHRASE_MIN_LENGTH - pass.length === 1 ? 'character' : 'characters'}`
      : !matches
        ? 'The two passphrases don’t match yet.'
        : 'Ready. Keep the passphrase somewhere safe: without it the file can’t be opened.';
  return (
    <View style={styles.preview} testID="export-panel">
      <Text style={styles.rowTitle}>Export my data</Text>
      <TextInput
        value={pass}
        onChangeText={setPass}
        placeholder="Passphrase"
        {...inputColors}
        style={styles.field}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="newPassword"
        accessibilityLabel="Passphrase"
      />
      <TextInput
        value={confirm}
        onChangeText={setConfirm}
        placeholder="The same passphrase again"
        {...inputColors}
        style={styles.field}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="newPassword"
        accessibilityLabel="Passphrase again"
      />
      <Text style={styles.rowSubtitle} accessibilityLiveRegion="polite" testID="export-hint">
        {hint}
      </Text>
      <Pressable
        onPress={() => canProtect && props.onExport(pass)}
        disabled={!canProtect}
        accessibilityRole="button"
        accessibilityLabel="Export protected"
        accessibilityState={{ disabled: !canProtect, busy: props.busy }}
        style={({ pressed }) => [
          styles.previewButton,
          styles.previewConfirm,
          !canProtect && styles.off,
          pressed && { opacity: 0.85 },
        ]}
        testID="export-protected"
      >
        {props.busy ? (
          <ActivityIndicator color={colors.background} />
        ) : (
          <View style={styles.inline}>
            <KeyRound size={16} color={canProtect ? colors.background : colors.textMuted} strokeWidth={2.5} />
            <Text style={[styles.previewConfirmText, !canProtect && styles.offText]}>Export protected</Text>
          </View>
        )}
      </Pressable>
      <View style={styles.previewButtons}>
        <Pressable
          onPress={props.onCancel}
          disabled={props.busy}
          accessibilityRole="button"
          accessibilityLabel="Cancel export"
          style={({ pressed }) => [styles.previewButton, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.previewCancel}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={() => props.onExport(null)}
          disabled={props.busy}
          accessibilityRole="button"
          accessibilityLabel="Export without a passphrase"
          style={({ pressed }) => [styles.previewButton, pressed && { opacity: 0.7 }]}
          testID="export-plain"
        >
          <Text style={styles.previewCancel}>Without a passphrase</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** A protected backup was picked: ask for its passphrase. */
function UnlockPanel(props: {
  busy: boolean;
  error: string | null;
  onUnlock: (passphrase: string) => void;
  onCancel: () => void;
}) {
  const [pass, setPass] = useState('');
  const can = pass.length > 0 && !props.busy;
  return (
    <View style={styles.preview} testID="restore-unlock" accessibilityLiveRegion="polite">
      <Text style={styles.rowTitle}>This backup is protected</Text>
      <Text style={styles.rowSubtitle}>Enter the passphrase it was exported with.</Text>
      <TextInput
        value={pass}
        onChangeText={setPass}
        onSubmitEditing={() => can && props.onUnlock(pass)}
        placeholder="Passphrase"
        {...inputColors}
        style={styles.field}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        textContentType="password"
        accessibilityLabel="Backup passphrase"
      />
      {props.error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {props.error}
        </Text>
      ) : null}
      <View style={styles.previewButtons}>
        <Pressable
          onPress={props.onCancel}
          disabled={props.busy}
          accessibilityRole="button"
          accessibilityLabel="Cancel restore"
          style={({ pressed }) => [styles.previewButton, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.previewCancel}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={() => can && props.onUnlock(pass)}
          disabled={!can}
          accessibilityRole="button"
          accessibilityLabel="Open backup"
          accessibilityState={{ disabled: !can, busy: props.busy }}
          style={({ pressed }) => [
            styles.previewButton,
            styles.previewConfirm,
            !can && styles.off,
            pressed && { opacity: 0.85 },
          ]}
          testID="restore-unlock-confirm"
        >
          {props.busy ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={[styles.previewConfirmText, !can && styles.offText]}>Open</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

/** One monthly bill: what, how much, and the day it comes back on. */
function BillRow({
  bill,
  last,
  onSetDay,
  onRemove,
}: {
  bill: Bill;
  last: boolean;
  onSetDay: (day: number) => void;
  onRemove: () => void;
}) {
  const { money } = useMoney();
  return (
    <View style={[styles.row, last && styles.lastRow]} testID={`bill-${bill.id}`}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {bill.label}
        </Text>
        <Text style={styles.rowSubtitle}>
          {money(bill.cents)} · on the {ordinal(bill.day)}
          {bill.day > 28 ? ' (or the month’s last day)' : ''}
        </Text>
      </View>
      <IconButton
        icon={Minus}
        size={16}
        label={`Earlier day for ${bill.label}`}
        onPress={() => onSetDay(bill.day - 1)}
        disabled={bill.day <= 1}
        filled
      />
      <IconButton
        icon={Plus}
        size={16}
        label={`Later day for ${bill.label}`}
        onPress={() => onSetDay(bill.day + 1)}
        disabled={bill.day >= 31}
        filled
      />
      <IconButton
        icon={X}
        size={16}
        label={`Stop repeating ${bill.label}`}
        onPress={onRemove}
        color={colors.textMuted}
      />
    </View>
  );
}

/** Every card with a switch to show it and arrows to move it. Changes apply at once. */
function ArrangePanel(props: {
  order: HomeCard[];
  hidden: HomeCard[];
  onChange: (patch: Partial<Settings>) => void;
  onDone: () => void;
}) {
  const { order, hidden } = props;
  const move = (i: number, dir: -1 | 1) => {
    const next = [...order];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    props.onChange({ homeOrder: next });
  };
  const changed = hidden.length > 0 || order.join() !== HOME_CARDS.join();
  return (
    <View style={styles.arrange} testID="arrange-panel">
      {order.map((card, i) => {
        const label = HOME_CARD_LABELS[card];
        const shown = !hidden.includes(card);
        return (
          <View key={card} style={styles.arrangeRow}>
            <Text style={[styles.arrangeLabel, !shown && styles.arrangeOff]} numberOfLines={1}>
              {label}
            </Text>
            <IconButton
              icon={ArrowUp}
              size={16}
              label={`Move ${label} up`}
              onPress={() => move(i, -1)}
              disabled={i === 0}
            />
            <IconButton
              icon={ArrowDown}
              size={16}
              label={`Move ${label} down`}
              onPress={() => move(i, 1)}
              disabled={i === order.length - 1}
            />
            <Switch
              value={shown}
              onValueChange={(on) =>
                props.onChange({ homeHidden: on ? hidden.filter((c) => c !== card) : [...hidden, card] })
              }
              {...SWITCH_COLORS}
              accessibilityLabel={`Show ${label}`}
              testID={`show-${card}`}
            />
          </View>
        );
      })}
      <View style={styles.previewButtons}>
        <Pressable
          onPress={() => props.onChange({ homeOrder: [...HOME_CARDS], homeHidden: [] })}
          disabled={!changed}
          accessibilityRole="button"
          accessibilityLabel="Reset the home screen"
          accessibilityState={{ disabled: !changed }}
          style={({ pressed }) => [styles.previewButton, pressed && { opacity: 0.7 }]}
        >
          <Text style={[styles.previewCancel, !changed && styles.offText]}>Reset</Text>
        </Pressable>
        <Pressable
          onPress={props.onDone}
          accessibilityRole="button"
          accessibilityLabel="Done arranging"
          style={({ pressed }) => [styles.previewButton, styles.previewConfirm, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.previewConfirmText}>Done</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** The next choice up or down a fixed list, staying put at either end. */
function stepChoice(choices: readonly number[], current: number, dir: 1 | -1): number {
  const i = choices.indexOf(current);
  if (i === -1) return choices[0];
  return choices[Math.min(choices.length - 1, Math.max(0, i + dir))];
}

export function relockLabel(sec: number): string {
  if (sec === 0) return 'At once';
  return sec < 60 ? `${sec} s` : `${sec / 60} min`;
}

function stepRelock(current: number, dir: 1 | -1): number {
  const i = RELOCK_CHOICES_SEC.indexOf(current);
  const at = i === -1 ? RELOCK_CHOICES_SEC.indexOf(30) : i;
  return RELOCK_CHOICES_SEC[Math.min(RELOCK_CHOICES_SEC.length - 1, Math.max(0, at + dir))];
}

/** Exactly what restoring will add, before anything is written. */
function RestorePreview(props: {
  stats: MergeStats;
  exportedAt: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { stats } = props;
  const parts = [
    stats.daysAdded ? plural(stats.daysAdded, 'new day', 'new days') : '',
    stats.daysMerged ? plural(stats.daysMerged, 'day combined', 'days combined') : '',
    stats.notesAdded ? plural(stats.notesAdded, 'note', 'notes') : '',
    stats.expensesAdded ? plural(stats.expensesAdded, 'expense', 'expenses') : '',
    stats.habitsAdded ? plural(stats.habitsAdded, 'custom habit', 'custom habits') : '',
    stats.countdownsAdded ? plural(stats.countdownsAdded, 'countdown', 'countdowns') : '',
    stats.pinnedAdded ? plural(stats.pinnedAdded, 'pinned note', 'pinned notes') : '',
    stats.billsAdded ? plural(stats.billsAdded, 'monthly bill', 'monthly bills') : '',
    stats.goalsAdded ? plural(stats.goalsAdded, 'weekly goal', 'weekly goals') : '',
  ].filter(Boolean);
  const when = props.exportedAt ? new Date(props.exportedAt) : null;
  return (
    <View style={styles.preview} testID="restore-preview" accessibilityLiveRegion="polite">
      <Text style={styles.rowTitle}>Restore this backup?</Text>
      {when && !Number.isNaN(when.getTime()) ? (
        <Text style={styles.rowSubtitle}>Exported {when.toDateString()}</Text>
      ) : null}
      <Text style={styles.previewText}>It will add {parts.join(', ')}. Nothing on this phone is replaced.</Text>
      <View style={styles.previewButtons}>
        <Pressable
          onPress={props.onCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel restore"
          style={({ pressed }) => [styles.previewButton, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.previewCancel}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={props.onConfirm}
          accessibilityRole="button"
          accessibilityLabel="Restore"
          style={({ pressed }) => [styles.previewButton, styles.previewConfirm, pressed && { opacity: 0.85 }]}
          testID="restore-confirm"
        >
          <Text style={styles.previewConfirmText}>Restore</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.group}>{children}</View>
    </View>
  );
}

function Row({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function Stepper(props: {
  value: string;
  label: string;
  onDown: () => void;
  onUp: () => void;
  canDown: boolean;
  canUp: boolean;
  testID: string;
}) {
  return (
    <View style={styles.stepper}>
      <IconButton
        icon={Minus}
        label={`Decrease ${props.label}`}
        onPress={props.onDown}
        disabled={!props.canDown}
        size={16}
        filled
      />
      <Text style={styles.stepValue} testID={`${props.testID}-value`}>
        {props.value}
      </Text>
      <IconButton
        icon={Plus}
        label={`Increase ${props.label}`}
        onPress={props.onUp}
        disabled={!props.canUp}
        size={16}
        filled
      />
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
    maxHeight: '88%',
    alignSelf: 'center',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingBottom: space.sm,
  },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  scroll: { flexGrow: 0 },
  body: { paddingHorizontal: space.xl, paddingBottom: space.sm, gap: space.xl },
  section: { gap: space.sm },
  sectionTitle: { ...type.label, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6 },
  group: { backgroundColor: colors.cardRaised, borderRadius: radius.md, paddingHorizontal: space.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 64,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { ...type.body, color: colors.text, fontWeight: '600' },
  rowSubtitle: { ...type.caption, color: colors.textSecondary },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  stepValue: {
    ...type.body,
    color: colors.text,
    fontWeight: '600',
    minWidth: 52,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  exportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 64,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  preview: {
    gap: space.sm,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  previewText: { ...type.label, fontWeight: '400', color: colors.text },
  lastRow: { borderBottomWidth: 0 },
  turnOff: { ...type.label, color: colors.notes, fontWeight: '700' },
  arrange: { paddingVertical: space.sm, gap: 2 },
  arrangeRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 48 },
  arrangeLabel: { ...type.body, color: colors.text, flex: 1 },
  arrangeOff: { color: colors.textMuted },
  previewButtons: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  previewButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  previewConfirm: { backgroundColor: colors.notes },
  previewCancel: { ...type.label, color: colors.textSecondary, fontWeight: '700' },
  previewConfirmText: { ...type.label, color: colors.background, fontWeight: '700' },
  eraseButton: { backgroundColor: colors.danger },
  field: {
    minHeight: 44,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    color: colors.text,
    ...type.body,
  },
  off: { backgroundColor: colors.card },
  offText: { color: colors.textMuted },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  error: { ...type.caption, color: colors.danger },
  danger: { color: colors.danger },
  privacy: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.md },
  privacyText: { ...type.caption, color: colors.textSecondary, flex: 1 },
  version: { ...type.caption, color: colors.textMuted, textAlign: 'center' },
});
