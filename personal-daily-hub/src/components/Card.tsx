import type { LucideIcon } from '../icons';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, space, tint, type } from '../theme';

type Props = {
  icon: LucideIcon;
  accent: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  testID?: string;
};

export function Card({ icon: Icon, accent, title, subtitle, right, children, testID }: Props) {
  return (
    <View style={styles.card} testID={testID}>
      <View style={styles.header}>
        <View style={[styles.iconWrap, { backgroundColor: tint(accent) }]}>
          <Icon size={18} color={accent} strokeWidth={2.25} />
        </View>
        <View style={styles.titles}>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.lg,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titles: { flex: 1, gap: 2 },
  title: { ...type.title, color: colors.text },
  subtitle: { ...type.caption, color: colors.textSecondary },
});
