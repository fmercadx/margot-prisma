import { ChartColumnBig, Crown, InfinityIcon, ListPlus, type LucideIcon } from '../icons';
import { useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PAYWALL_HEADLINES, PREMIUM_PRICE_LABEL, type PaywallReason } from '../lib/premium';
import { colors, HIT, radius, space, tint, type } from '../theme';

type Props = {
  reason: PaywallReason | null;
  onClose: () => void;
  /** Runs the (mock) purchase. Resolves once the parent has unlocked. */
  onUnlock: () => Promise<void>;
};

const BENEFITS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: InfinityIcon,
    title: 'Unlimited entries',
    body: 'Capture every thought — no daily cap on notes.',
  },
  {
    icon: ChartColumnBig,
    title: 'Historical graphs',
    body: 'Seven-day trends for water, energy and spending.',
  },
  {
    icon: ListPlus,
    title: 'Custom habits',
    body: 'Build your checklist around your own routine.',
  },
];

/**
 * A bottom sheet rather than a full-screen takeover: the day stays visible
 * behind it, and "Not now", the backdrop, and Android's back gesture all
 * dismiss it. Whatever the person was typing is kept.
 */
export function PaywallModal({ reason, onClose, onUnlock }: Props) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);

  const unlock = async () => {
    setBusy(true);
    try {
      await onUnlock();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={reason !== null}
      transparent
      animationType="slide"
      onRequestClose={busy ? () => {} : onClose}
      statusBarTranslucent={Platform.OS === 'android'}
      navigationBarTranslucent={Platform.OS === 'android'}
    >
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={busy ? undefined : onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <View
          style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}
          accessibilityViewIsModal
          testID="paywall"
        >
          <View style={styles.grabber} />

          <View style={styles.crown}>
            <Crown size={26} color={colors.premium} strokeWidth={2.25} />
          </View>
          <Text style={styles.kicker}>{reason ? PAYWALL_HEADLINES[reason] : ''}</Text>
          <Text style={styles.title} accessibilityRole="header">
            Unlock Daily Hub Premium
          </Text>

          <View style={styles.benefits}>
            {BENEFITS.map(({ icon: Icon, title, body }) => (
              <View key={title} style={styles.benefit}>
                <View style={styles.benefitIcon}>
                  <Icon size={18} color={colors.premium} strokeWidth={2.25} />
                </View>
                <View style={styles.benefitText}>
                  <Text style={styles.benefitTitle}>{title}</Text>
                  <Text style={styles.benefitBody}>{body}</Text>
                </View>
              </View>
            ))}
          </View>

          <Pressable
            onPress={unlock}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Unlock Premium for ${PREMIUM_PRICE_LABEL}`}
            accessibilityState={{ busy, disabled: busy }}
            style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
            testID="paywall-unlock"
          >
            {busy ? (
              <ActivityIndicator color={colors.onPremium} />
            ) : (
              <Text style={styles.ctaText}>Unlock Premium for {PREMIUM_PRICE_LABEL}</Text>
            )}
          </Pressable>

          <Pressable
            onPress={onClose}
            disabled={busy}
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.6 }]}
            testID="paywall-dismiss"
          >
            <Text style={styles.secondaryText}>Not now</Text>
          </Pressable>

          <Text style={styles.fine}>Demo build — no payment is taken.</Text>
        </View>
      </View>
    </Modal>
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
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    alignItems: 'center',
    gap: space.md,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.hairline, marginBottom: space.sm },
  crown: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: tint(colors.premium, 0.14),
    alignItems: 'center',
    justifyContent: 'center',
  },
  kicker: { ...type.label, color: colors.textSecondary, textAlign: 'center' },
  title: { fontSize: 24, fontWeight: '700', letterSpacing: -0.4, color: colors.text, textAlign: 'center' },
  benefits: { alignSelf: 'stretch', gap: space.lg, marginVertical: space.sm },
  benefit: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  benefitIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.cardRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitText: { flex: 1, gap: 2 },
  benefitTitle: { ...type.body, fontWeight: '600', color: colors.text },
  benefitBody: { ...type.label, fontWeight: '400', color: colors.textSecondary },
  cta: {
    alignSelf: 'stretch',
    minHeight: 54,
    borderRadius: radius.md,
    backgroundColor: colors.premium,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.sm,
  },
  ctaText: { fontSize: 16, fontWeight: '700', color: colors.onPremium },
  secondary: { minHeight: HIT, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { ...type.body, fontWeight: '600', color: colors.textSecondary },
  fine: { ...type.caption, color: colors.textMuted, textAlign: 'center' },
});
