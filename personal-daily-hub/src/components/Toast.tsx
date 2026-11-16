import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Undo2 } from '../icons';
import { colors, HIT, radius, space, type } from '../theme';

type Props = { message: string; onUndo: () => void };

/** A bar above the bottom edge offering to undo the last delete. */
export function UndoToast({ message, onUndo }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[styles.wrap, { bottom: insets.bottom + space.lg }]}
      pointerEvents="box-none"
      accessibilityLiveRegion="polite"
      testID="undo-toast"
    >
      <View style={styles.bar}>
        <Text style={styles.text} numberOfLines={1}>
          {message}
        </Text>
        <Pressable
          onPress={onUndo}
          accessibilityRole="button"
          accessibilityLabel="Undo"
          style={({ pressed }) => [styles.undo, pressed && { opacity: 0.7 }]}
          hitSlop={4}
        >
          <Undo2 size={16} color={colors.notes} strokeWidth={2.5} />
          <Text style={styles.undoText}>Undo</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center' },
  bar: {
    width: '100%',
    maxWidth: 560,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.cardRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    paddingLeft: space.lg,
    paddingRight: space.xs,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  text: { ...type.body, color: colors.text, flex: 1 },
  undo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: HIT,
    paddingHorizontal: space.md,
  },
  undoText: { ...type.label, color: colors.notes, fontWeight: '700' },
});
