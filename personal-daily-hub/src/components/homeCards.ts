import type { HomeCard } from '../lib/store';

/** What each home-screen card is called in Settings: its title on screen. */
export const HOME_CARD_LABELS: Record<HomeCard, string> = {
  focus: 'Today’s focus',
  notes: 'Quick Capture',
  habits: 'Habits',
  wellbeing: 'Wellbeing',
  expenses: 'Expenses',
  journal: 'Journal',
  onThisDay: 'On this day',
  countdowns: 'Coming up',
  insights: 'Insights',
  history: 'History',
};
