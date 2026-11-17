// Words for the five mood faces, shared by the picker, the charts and the
// day view so they always agree.

export const MOOD_WORDS = ['Rough', 'Low', 'Okay', 'Good', 'Great'] as const;

/** 1–5 -> "Good" */
export function moodWord(value: number): string {
  return MOOD_WORDS[Math.min(5, Math.max(1, Math.round(value))) - 1];
}
