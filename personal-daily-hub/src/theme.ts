// Design tokens. Every colour on screen comes from here.
//
// Contrast, measured against the card surface (#1E1E1E):
//   text 15.3:1 · textSecondary 6.6:1 · textMuted 5.1:1 (4.6:1 on inputs)
//   Module accents are all >= 3:1, so they are legible as marks, but they are
//   never used for body text — labels and values stay in the text tokens.

export const colors = {
  background: '#121212',
  card: '#1E1E1E',
  cardRaised: '#262626',
  border: '#2E2E2E',
  hairline: '#333333',

  text: '#F5F5F5',
  textSecondary: '#A3A3A3',
  textMuted: '#919191',

  // One accent per module, used for its icon, progress fill and chart marks.
  notes: '#A78BFA',
  habits: '#4ADE80',
  water: '#38BDF8',
  energy: '#FBBF24',
  expenses: '#FB7185',
  history: '#A78BFA',

  premium: '#E8C468',
  onPremium: '#121212',
  danger: '#F87171',
  backdrop: 'rgba(0,0,0,0.6)',
} as const;

/** The accent at low opacity, for the tinted circle behind a module icon. */
export function tint(hex: string, alpha = 0.14): string {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 20, pill: 999 } as const;

export const type = {
  hero: { fontSize: 34, fontWeight: '700' as const, letterSpacing: -0.5 },
  title: { fontSize: 17, fontWeight: '600' as const, letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: '400' as const },
  label: { fontSize: 13, fontWeight: '500' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
} as const;

/** Minimum touch target, per the iOS and Material guidelines. */
export const HIT = 44;

/**
 * Spread onto every TextInput. Android otherwise draws its own underline,
 * a theme-coloured cursor and teal selection handles.
 */
export const inputColors = {
  placeholderTextColor: colors.textMuted,
  underlineColorAndroid: 'transparent',
  cursorColor: colors.text,
  selectionColor: tint(colors.notes, 0.45),
  selectionHandleColor: colors.notes,
} as const;
