import { Annoyed, Droplets, Frown, GlassWater, Laugh, Meh, Minus, Moon, Plus, Smile, X, Zap, type LucideIcon } from '../icons';
import { MOOD_WORDS } from '../lib/mood';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ENERGY_MAX, ENERGY_MIN, SLEEP_MAX, SLEEP_START, SLEEP_STEP, WATER_MAX } from '../lib/store';
import { colors, HIT, radius, space, tint, type } from '../theme';
import { Card } from './Card';
import { IconButton } from './IconButton';
import { StepSlider } from './StepSlider';

type Props = {
  water: number;
  goal: number;
  energy: number | null;
  onAdjustWater: (delta: number) => void;
  onSetEnergy: (value: number) => void;
  onDragStateChange: (dragging: boolean) => void;
  mood: number | null;
  /** null clears the day's mood (tapping the chosen face again). */
  onSetMood: (value: number | null) => void;
  /** Hours slept last night, or null. */
  sleep: number | null;
  onSetSleep: (value: number | null) => void;
};

/** 7.5 -> "7½ h" */
export function sleepLabel(hours: number): string {
  const whole = Math.floor(hours);
  return `${whole}${hours - whole >= 0.5 ? '½' : ''} h`;
}

export function energyWord(v: number): string {
  if (v <= 2) return 'Drained';
  if (v <= 4) return 'Low';
  if (v <= 6) return 'Steady';
  if (v <= 8) return 'Energized';
  return 'Unstoppable';
}

export function WaterEnergy(props: Props) {
  const { water, goal, energy, onAdjustWater, onSetEnergy, onDragStateChange } = props;
  const over = Math.max(0, water - goal);

  return (
    <Card
      icon={Droplets}
      accent={colors.water}
      title="Wellbeing"
      subtitle="Water, sleep, energy and mood"
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
            <Text style={styles.valueSub}> / {goal} glasses</Text>
          </Text>
        </View>

        <View
          style={styles.segments}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Water progress"
          accessibilityValue={{ min: 0, max: goal, now: Math.min(water, goal) }}
        >
          {Array.from({ length: goal }, (_, i) => (
            <View
              key={i}
              style={[styles.segment, { backgroundColor: i < water ? colors.water : tint(colors.water, 0.16) }]}
            />
          ))}
        </View>

        <View style={styles.rowBetween}>
          <Text style={styles.hint}>
            {water >= goal
              ? over > 0
                ? `Goal reached · +${over} extra`
                : 'Goal reached'
              : `${goal - water} to go`}
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

      <SleepRow value={props.sleep} onChange={props.onSetSleep} />

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

      <View style={styles.rule} />

      <MoodPicker value={props.mood} onChange={props.onSetMood} />
    </Card>
  );
}

/** Last night's sleep in half-hour steps. The first press starts at 7 hours. */
function SleepRow({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const step = (dir: 1 | -1) => onChange(value === null ? SLEEP_START : value + dir * SLEEP_STEP);
  return (
    <View style={styles.section}>
      <View style={styles.rowBetween}>
        <View style={styles.labelRow}>
          <Moon size={16} color={colors.sleep} />
          <Text style={styles.label}>Sleep</Text>
        </View>
        <Text style={styles.value} testID="sleep-value">
          {value === null ? <Text style={styles.valueSub}>Not logged</Text> : sleepLabel(value)}
        </Text>
      </View>
      <View style={styles.rowBetween}>
        <Text style={styles.hint}>Last night</Text>
        <View style={styles.stepper}>
          {value !== null ? (
            <IconButton icon={X} size={16} label="Clear sleep" onPress={() => onChange(null)} color={colors.textMuted} />
          ) : null}
          <IconButton
            icon={Minus}
            label="Half an hour less sleep"
            onPress={() => step(-1)}
            disabled={value === null || value <= 0}
            filled
            testID="sleep-minus"
          />
          <IconButton
            icon={Plus}
            label={value === null ? 'Log sleep' : 'Half an hour more sleep'}
            onPress={() => step(1)}
            disabled={value !== null && value >= SLEEP_MAX}
            color={colors.sleep}
            filled
            testID="sleep-plus"
          />
        </View>
      </View>
    </View>
  );
}

const FACES: LucideIcon[] = [Frown, Annoyed, Meh, Smile, Laugh];

/** Five faces, one choice. Tapping the chosen face again clears it. */
function MoodPicker({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <View style={styles.section}>
      <View style={styles.rowBetween}>
        <View style={styles.labelRow}>
          <Smile size={16} color={colors.mood} />
          <Text style={styles.label}>Mood</Text>
        </View>
        <Text style={styles.value} testID="mood-value">
          {value === null ? <Text style={styles.valueSub}>Not logged</Text> : MOOD_WORDS[value - 1]}
        </Text>
      </View>
      <View style={styles.faces} accessibilityRole="radiogroup" accessibilityLabel="Mood">
        {FACES.map((Face, i) => {
          const level = i + 1;
          const chosen = value === level;
          return (
            <Pressable
              key={level}
              onPress={() => onChange(chosen ? null : level)}
              accessibilityRole="radio"
              accessibilityState={{ checked: chosen }}
              accessibilityLabel={`Mood: ${MOOD_WORDS[i]}`}
              style={({ pressed }) => [
                styles.face,
                chosen && { backgroundColor: tint(colors.mood, 0.2), borderColor: colors.mood },
                pressed && { opacity: 0.7 },
              ]}
              testID={`mood-${level}`}
            >
              <Face size={24} color={chosen ? colors.mood : colors.textSecondary} strokeWidth={chosen ? 2.5 : 2} />
            </Pressable>
          );
        })}
      </View>
    </View>
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
  faces: { flexDirection: 'row', gap: space.sm },
  face: {
    flex: 1,
    minHeight: HIT + 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: colors.cardRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
