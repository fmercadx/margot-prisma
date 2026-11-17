import type { ReactNode } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FileDown, Minus, Plus, ShieldCheck, X } from '../icons';
import { hourLabel } from '../lib/reminders';
import {
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
  privacy: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.md },
  privacyText: { ...type.caption, color: colors.textSecondary, flex: 1 },
  version: { ...type.caption, color: colors.textMuted, textAlign: 'center' },
});
