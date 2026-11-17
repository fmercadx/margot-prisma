import type { LucideIcon } from '../icons';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { colors, HIT, radius } from '../theme';

type Props = {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  color?: string;
  size?: number;
  disabled?: boolean;
  filled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** An icon-only button with a full 44pt target and a spoken label. */
export function IconButton({
  icon: Icon,
  label,
  onPress,
  color = colors.textSecondary,
  size = 18,
  disabled,
  filled,
  style,
  testID,
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={4}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        filled && styles.filled,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Icon size={size} color={color} strokeWidth={2.25} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minWidth: HIT,
    minHeight: HIT,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filled: { backgroundColor: colors.cardRaised },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.35 },
});
