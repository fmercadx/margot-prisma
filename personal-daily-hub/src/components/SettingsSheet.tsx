import type { ReactNode } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FileDown, FileUp, Minus, Plus, ShieldCheck, Trash2, X } from '../icons';
import { stepBudget } from '../lib/categories';
import { formatCents } from '../lib/money';
import { hourLabel } from '../lib/reminders';
import type { MergeStats } from '../lib/store';
import {
  RELOCK_CHOICES_SEC,
  REMINDER_HOUR_MAX,
  REMINDER_HOUR_MIN,
  WATER_GOAL_MAX,
  WATER_GOAL_MIN,
  type Settings,
} from '../lib/store';
import { colors, radius, space, type } from '../theme';
import { IconButton } from './IconButton';

type Props = {
  visible: boolean;
  onClose: () => void;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  reminderOn: boolean;
  lockSupported: boolean;
  lockBusy: boolean;
  onToggleLock: (next: boolean) => void;
  exportSupported: boolean;
  exportBusy: boolean;
  onExport: () => void;
  encrypted: boolean;
  version: string;
  hapticsSupported: boolean;
  restoreBusy: boolean;
  onRestore: () => void;
  /** What a picked backup would add, waiting for the person to confirm. */
  restorePreview: { stats: MergeStats; exportedAt: string | null } | null;
  onConfirmRestore: () => void;
  onCancelRestore: () => void;
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
        <Pressable style={styles.backdrop} onPress={p.onClose} accessibilityRole="button" accessibilityLabel="Dismiss settings" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]} accessibilityViewIsModal testID="settings">
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
              <Row
                title="Reminder time"
                subtitle={p.reminderOn ? 'Daily reminder is on' : 'Turn it on with the bell'}
              >
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
              {p.hapticsSupported ? (
                <Row title="Haptic feedback" subtitle="A light tap when you tick, step or save">
                  <Switch
                    value={s.haptics}
                    onValueChange={(haptics) => p.onChange({ haptics })}
                    trackColor={{ false: colors.hairline, true: colors.notes }}
                    thumbColor={colors.text}
                    accessibilityLabel="Haptic feedback"
                    testID="haptics-switch"
                  />
                </Row>
              ) : null}
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
                      trackColor={{ false: colors.hairline, true: colors.notes }}
                      thumbColor={colors.text}
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
                <Pressable
                  onPress={p.onExport}
                  disabled={p.exportBusy}
                  accessibilityRole="button"
                  accessibilityLabel="Export my data"
                  accessibilityHint="Saves everything as a file you choose where to send. The file is not encrypted."
                  style={({ pressed }) => [styles.exportRow, pressed && { opacity: 0.7 }]}
                  testID="export"
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>Export my data</Text>
                    <Text style={styles.rowSubtitle}>
                      A JSON file of everything you have logged, sent where you choose. The file is not encrypted.
                    </Text>
                  </View>
                  {p.exportBusy ? (
                    <ActivityIndicator color={colors.textSecondary} />
                  ) : (
                    <FileDown size={20} color={colors.textSecondary} />
                  )}
                </Pressable>
              ) : null}

              {p.restorePreview ? (
                <RestorePreview {...p.restorePreview} onConfirm={p.onConfirmRestore} onCancel={p.onCancelRestore} />
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
      <IconButton icon={Plus} label={`Increase ${props.label}`} onPress={props.onUp} disabled={!props.canUp} size={16} filled />
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
  stepValue: { ...type.body, color: colors.text, fontWeight: '600', minWidth: 52, textAlign: 'center', fontVariant: ['tabular-nums'] },
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
  danger: { color: colors.danger },
  privacy: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.md },
  privacyText: { ...type.caption, color: colors.textSecondary, flex: 1 },
  version: { ...type.caption, color: colors.textMuted, textAlign: 'center' },
});
