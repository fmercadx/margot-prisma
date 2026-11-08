import { Droplets, GlassWater, Minus, Plus, Zap } from '../icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ENERGY_MAX, ENERGY_MIN, WATER_GOAL, WATER_MAX } from '../lib/store';
import { colors, HIT, radius, space, tint, type } from '../theme';
import { Card } from './Card';
import { IconButton } from './IconButton';
import { StepSlider } from './StepSlider';

type Props = {
  water: number;
  energy: number | null;
  onAdjustWater: (delta: number) => void;
  onSetEnergy: (value: number) => void;
  onDragStateChange: (dragging: boolean) => void;
};

export function energyWord(v: number): string {
  if (v <= 2) return 'Drained';
  if (v <= 4) return 'Low';
  if (v <= 6) return 'Steady';
  if (v <= 8) return 'Energized';
  return 'Unstoppable';
}

export function WaterEnergy({ water, energy, onAdjustWater, onSetEnergy, onDragStateChange }: Props) {
  const over = Math.max(0, water - WATER_GOAL);

  return (
    <Card
      icon={Droplets}
      accent={colors.water}
      title="Water & Energy"
      subtitle="Fuel check"
      testID="card-water"
    >
      {/* Water: one segment per glass, so progress reads at a glance. */}
      <View style={styles.section}>
        <View style={styles.rowBetween}>
          <View style={styles.labelRow}>
            <GlassWater size={16} color={colors.water} />
            <Text style={styles.label}>Water</Text>
          </View>
          <Text style={styles.value} testID="water-value">
            {water}
            <Text style={styles.valueSub}> / {WATER_GOAL} glasses</Text>
          </Text>
        </View>

        <View
          style={styles.segments}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Water progress"
          accessibilityValue={{ min: 0, max: WATER_GOAL, now: Math.min(water, WATER_GOAL) }}
        >
          {Array.from({ length: WATER_GOAL }, (_, i) => (
            <View
              key={i}
              style={[styles.segment, { backgroundColor: i < water ? colors.water : tint(colors.water, 0.16) }]}
            />
          ))}
        </View>

        <View style={styles.rowBetween}>
          <Text style={styles.hint}>
            {water >= WATER_GOAL
              ? over > 0
                ? `Goal reached · +${over} extra`
                : 'Goal reached'
              : `${WATER_GOAL - water} to go`}
          </Text>
          <View style={styles.stepper}>
            <IconButton
              icon={Minus}
              label="Remove a glass of water"
              onPress={() => onAdjustWater(-1)}
              disabled={water <= 0}
              filled
              testID="water-minus"
            />
            <Pressable
              onPress={() => onAdjustWater(1)}
              disabled={water >= WATER_MAX}
              accessibilityRole="button"
              accessibilityLabel="Add a glass of water"
              style={({ pressed }) => [styles.addGlass, pressed && { opacity: 0.8 }]}
              testID="water-plus"
            >
              <Plus size={16} color={colors.background} strokeWidth={2.75} />
              <Text style={styles.addGlassText}>Glass</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <View style={styles.rule} />

      <View style={styles.section}>
        <View style={styles.rowBetween}>
          <View style={styles.labelRow}>
            <Zap size={16} color={colors.energy} />
            <Text style={styles.label}>Energy</Text>
          </View>
          <Text style={styles.value} testID="energy-value">
            {energy === null ? (
              <Text style={styles.valueSub}>Not logged</Text>
            ) : (
              <>
                {energy}
                <Text style={styles.valueSub}>
                  /{ENERGY_MAX} · {energyWord(energy)}
                </Text>
              </>
            )}
          </Text>
        </View>
        <StepSlider
          value={energy}
          min={ENERGY_MIN}
          max={ENERGY_MAX}
          color={colors.energy}
          onChange={onSetEnergy}
          onDragStateChange={onDragStateChange}
          accessibilityLabel="Energy level"
          describe={(v) => `${v} of ${ENERGY_MAX}, ${energyWord(v)}`}
          testID="energy-slider"
        />
        <View style={styles.rowBetween}>
          <Text style={styles.hint}>Running on empty</Text>
          <Text style={styles.hint}>Fully charged</Text>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.md },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  label: { ...type.label, color: colors.text },
  value: { ...type.title, color: colors.text, fontVariant: ['tabular-nums'] },
  valueSub: { ...type.label, color: colors.textSecondary },
  segments: { flexDirection: 'row', gap: 2 },
  segment: { flex: 1, height: 12, borderRadius: 4 },
  hint: { ...type.caption, color: colors.textMuted },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  addGlass: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: HIT,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.water,
  },
  addGlassText: { ...type.label, color: colors.background, fontWeight: '700' },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline },
});
