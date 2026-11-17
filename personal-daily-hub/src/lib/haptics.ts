// A light tap of feedback for the things a thumb does all day: ticking a
// habit, stepping water or energy, saving, deleting. Switchable in
// Settings; never throws, and does nothing on the web.

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const supported = Platform.OS === 'ios' || Platform.OS === 'android';
let enabled = true;

export function setHapticsEnabled(on: boolean) {
  enabled = on;
}

const run = (fn: () => Promise<void>) => {
  if (!supported || !enabled) return;
  fn().catch(() => {});
};

export const haptic = {
  /** A step or a toggle: habit ticks, water, energy, mood. */
  tick: () => run(() => Haptics.selectionAsync()),
  /** Something was saved: a note, an expense, a restore. */
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  /** Something was removed. */
  remove: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
};
