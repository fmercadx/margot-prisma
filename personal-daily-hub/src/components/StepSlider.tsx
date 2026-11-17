import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { colors, tint } from '../theme';

type Props = {
  value: number | null;
  min: number;
  max: number;
  color: string;
  onChange: (value: number) => void;
  /** Lets the parent stop its ScrollView stealing a horizontal drag. */
  onDragStateChange?: (dragging: boolean) => void;
  accessibilityLabel: string;
  describe?: (value: number) => string;
  testID?: string;
};

const TRACK = 8;
const THUMB = 26;

/**
 * A stepped slider built on PanResponder, so it can be styled to match and
 * needs no extra native module. Tap anywhere on the track or drag the
 * thumb. A null value draws an empty track with no thumb ("not logged").
 *
 * Screen readers get it as an adjustable control: swipe up/down to step.
 */
export function StepSlider(props: Props) {
  const { value, min, max, color } = props;
  const [width, setWidth] = useState(0);

  // PanResponder is created once, so it reads the latest props through a ref.
  const live = useRef({ props, width, startX: 0, last: value });
  live.current.props = props;
  live.current.width = width;

  const steps = max - min;

  const valueAt = (x: number) => {
    const w = live.current.width;
    if (w <= 0) return min;
    const usable = Math.max(1, w - THUMB);
    const ratio = Math.min(1, Math.max(0, (x - THUMB / 2) / usable));
    return min + Math.round(ratio * steps);
  };

  const emit = (x: number) => {
    const v = valueAt(x);
    if (v !== live.current.last) {
      live.current.last = v;
      live.current.props.onChange(v);
    }
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        // Children ignore touches (pointerEvents none), so locationX is
        // relative to the track itself. Moves are then start + dx, which is
        // stable even when the finger leaves the view.
        live.current.startX = e.nativeEvent.locationX;
        live.current.last = live.current.props.value;
        live.current.props.onDragStateChange?.(true);
        emit(live.current.startX);
      },
      onPanResponderMove: (_e, g) => emit(live.current.startX + g.dx),
      onPanResponderRelease: () => live.current.props.onDragStateChange?.(false),
      onPanResponderTerminate: () => live.current.props.onDragStateChange?.(false),
    }),
  ).current;

  const ratio = value === null ? 0 : (value - min) / steps;
  const usable = Math.max(0, width - THUMB);
  const thumbLeft = ratio * usable;

  return (
    <View
      style={styles.hit}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      {...responder.panHandlers}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityValue={
        value === null
          ? { text: 'Not logged' }
          : { min, max, now: value, text: props.describe?.(value) ?? String(value) }
      }
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        // From "not logged", either gesture lands on the middle step.
        if (value === null) return props.onChange(Math.round((min + max) / 2));
        if (e.nativeEvent.actionName === 'increment') props.onChange(Math.min(max, value + 1));
        if (e.nativeEvent.actionName === 'decrement') props.onChange(Math.max(min, value - 1));
      }}
      testID={props.testID}
    >
      <View pointerEvents="none" style={[styles.track, { backgroundColor: tint(color, 0.16) }]}>
        <View
          style={[styles.fill, { width: value === null ? 0 : thumbLeft + THUMB / 2, backgroundColor: color }]}
        />
      </View>
      <View pointerEvents="none" style={styles.ticks}>
        {Array.from({ length: steps + 1 }, (_, i) => (
          <View
            key={i}
            style={[
              styles.tick,
              { backgroundColor: value !== null && min + i <= value ? colors.background : colors.textMuted },
            ]}
          />
        ))}
      </View>
      {value !== null && width > 0 ? (
        <View pointerEvents="none" style={[styles.thumb, { left: thumbLeft, borderColor: color }]} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { height: 44, justifyContent: 'center' },
  track: { height: TRACK, borderRadius: TRACK / 2, overflow: 'hidden' },
  fill: { height: TRACK, borderRadius: TRACK / 2 },
  ticks: {
    position: 'absolute',
    left: THUMB / 2 - 1.5,
    right: THUMB / 2 - 1.5,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tick: { width: 3, height: 3, borderRadius: 1.5, opacity: 0.7 },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.text,
    borderWidth: 3,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
});
