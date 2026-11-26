import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LockKeyhole } from '../icons';
import { colors, radius, space, tint, type } from '../theme';

type Props = { busy: boolean; onUnlock: () => void };

/**
 * Stands in for the whole app while it is locked: nothing of the day is
 * rendered behind it, so there is nothing to glimpse or to reach with a
 * screen reader.
 */
export function LockScreen({ busy, onUnlock }: Props) {
  const insets = useSafeAreaInsets();

  // Ask straight away; the button is there if the prompt is dismissed.
  useEffect(() => {
    onUnlock();
    // Only on first show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]} testID="lock-screen">
      <View style={styles.badge}>
        <LockKeyhole size={30} color={colors.notes} strokeWidth={2.25} />
      </View>
      <Text style={styles.title} accessibilityRole="header">
        Personal Daily Hub is locked
      </Text>
      <Text style={styles.body}>Unlock with your fingerprint, face or phone PIN.</Text>
      <Pressable
        onPress={onUnlock}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Unlock"
        accessibilityState={{ busy, disabled: busy }}
        style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
        testID="unlock"
      >
        {busy ? <ActivityIndicator color={colors.background} /> : <Text style={styles.buttonText}>Unlock</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxl,
    gap: space.md,
  },
  badge: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: tint(colors.notes, 0.14),
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  title: { fontSize: 22, fontWeight: '700', color: colors.text, textAlign: 'center' },
  body: { ...type.body, color: colors.textSecondary, textAlign: 'center' },
  button: {
    marginTop: space.lg,
    minHeight: 52,
    minWidth: 200,
    borderRadius: radius.md,
    backgroundColor: colors.notes,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  buttonText: { fontSize: 16, fontWeight: '700', color: colors.background },
});
