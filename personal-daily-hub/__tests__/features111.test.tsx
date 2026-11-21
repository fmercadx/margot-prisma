import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import { isSealed } from '../src/lib/codec';
import { dayStorageKey, GOALS_KEY, HABITS_KEY, loadGoals, loadHabits, SETTINGS_KEY } from '../src/lib/storage';
import { DEFAULT_SETTINGS, EMPTY_DAY, type DayLog } from '../src/lib/store';
import HomeScreen from '../src/screens/HomeScreen';
import { colors } from '../src/theme';

// These tests render the whole app; the first pays for a cold module load.
jest.setTimeout(30_000);

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  jest.useFakeTimers({ now: new Date(2026, 10, 21, 9, 0) }); // Saturday; the week began Sunday, Nov 15
});
afterEach(() => jest.useRealTimers());

const advance = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

async function launch() {
  const view = await render(<HomeScreen />);
  await screen.findByText('Quick Capture');
  return view;
}

const week = () => within(screen.getByTestId('card-week'));

async function addGoal(text: string) {
  await fireEvent.changeText(week().getByLabelText('New goal for the week'), text);
  await fireEvent.press(week().getByRole('button', { name: 'Add goal' }));
}

/** Saved as an older build would have: plain JSON, sealed at the next launch. */
async function seed(key: string, value: unknown) {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}
const seedDay = (date: string, day: Partial<DayLog>) => seed(dayStorageKey(date), { ...EMPTY_DAY, ...day });

describe('this week', () => {
  test('three goals at most; tick one; they are saved sealed and come back', async () => {
    const view = await launch();
    expect(week().getByText(/Nov 15 – 21/)).toBeOnTheScreen();
    for (const g of ['Finish the report', 'Call Mum', 'Run 10k']) await addGoal(g);
    expect(week().queryByLabelText('New goal for the week')).not.toBeOnTheScreen();
    expect(week().getByText('Three is plenty. Tick one off or remove one to add another.')).toBeOnTheScreen();

    await fireEvent.press(week().getByRole('checkbox', { name: 'Call Mum' }));
    expect(week().getByLabelText('1 of 3 goals done')).toBeOnTheScreen();
    await advance(1000);
    expect(isSealed((await AsyncStorage.getItem(GOALS_KEY))!)).toBe(true);
    expect((await loadGoals()).map((g) => [g.text, g.week, g.doneAt !== undefined])).toEqual([
      ['Finish the report', '2026-11-15', false],
      ['Call Mum', '2026-11-15', true],
      ['Run 10k', '2026-11-15', false],
    ]);
    await view.unmount();

    await launch();
    expect(week().getByRole('checkbox', { name: 'Call Mum' })).toBeChecked();
    expect(week().getByRole('checkbox', { name: 'Run 10k' })).not.toBeChecked();
  });

  test('ticking off the last one says so; deleting can be undone', async () => {
    await launch();
    await addGoal('Finish the report');
    await addGoal('Call Mum');
    await fireEvent.press(week().getByRole('checkbox', { name: 'Finish the report' }));
    await fireEvent.press(week().getByRole('checkbox', { name: 'Call Mum' }));
    expect(screen.getByText('All 2 goals done this week. Nicely done.')).toBeOnTheScreen();
    expect(week().getByText(/all done, nice work/)).toBeOnTheScreen();

    await fireEvent.press(week().getByRole('button', { name: 'Delete goal: Call Mum' }));
    expect(week().queryByText('Call Mum')).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    expect(week().getByRole('checkbox', { name: 'Call Mum' })).toBeChecked();
  });

  test('last week’s unfinished goals can be brought over; done ones stay', async () => {
    await seed(GOALS_KEY, [
      { id: 'g1', text: 'Book the dentist', week: '2026-11-08', createdAt: 1 },
      { id: 'g2', text: 'Clear the inbox', week: '2026-11-08', createdAt: 2 },
      { id: 'g3', text: 'Already done', week: '2026-11-08', createdAt: 3, doneAt: 4 },
    ]);
    await launch();
    expect(week().getByTestId('goals-carry')).toHaveTextContent(/^2 unfinished goals from last week/);
    await fireEvent.press(week().getByRole('button', { name: 'Bring them into this week' }));
    expect(screen.getByText('Brought 2 goals into this week.')).toBeOnTheScreen();
    expect(week().queryByTestId('goals-carry')).not.toBeOnTheScreen();
    expect(
      week()
        .getAllByRole('checkbox')
        .map((c) => c.props.accessibilityLabel),
    ).toEqual(['Book the dentist', 'Clear the inbox']);
    expect(week().queryByText('Already done')).not.toBeOnTheScreen();
  });

  test('the offer can be put off, and is not made while there is no room', async () => {
    await seed(GOALS_KEY, [
      { id: 'g1', text: 'Book the dentist', week: '2026-11-08', createdAt: 1 },
      { id: 't1', text: 'One', week: '2026-11-15', createdAt: 5 },
      { id: 't2', text: 'Two', week: '2026-11-15', createdAt: 6 },
      { id: 't3', text: 'Three', week: '2026-11-15', createdAt: 7 },
    ]);
    await launch();
    expect(week().queryByTestId('goals-carry')).not.toBeOnTheScreen();
    await fireEvent.press(week().getByRole('button', { name: 'Delete goal: Three' }));
    expect(week().getByTestId('goals-carry')).toHaveTextContent(/^1 unfinished goal from last week/);
    await fireEvent.press(week().getByRole('button', { name: 'Not now' }));
    expect(week().queryByTestId('goals-carry')).not.toBeOnTheScreen();
  });

  test('filling in a day from last week shows last week’s goals', async () => {
    await seed(GOALS_KEY, [
      { id: 'g1', text: 'Book the dentist', week: '2026-11-08', createdAt: 1 },
      // Unfinished the week before: never offered into last week.
      { id: 'g0', text: 'Two weeks back', week: '2026-11-01', createdAt: 1 },
    ]);
    await launch();
    for (let i = 0; i < 7; i++) await fireEvent.press(screen.getByRole('button', { name: 'Log the day before' }));
    expect(week().getByText(/Nov 8 – 14 · last week/)).toBeOnTheScreen();
    expect(week().getByRole('checkbox', { name: 'Book the dentist' })).toBeOnTheScreen();
    expect(week().queryByTestId('goals-carry')).not.toBeOnTheScreen();
  });

  test('search finds a goal', async () => {
    await seed(GOALS_KEY, [{ id: 'g1', text: 'Book the dentist', week: '2026-11-15', createdAt: 1 }]);
    await launch();
    await fireEvent.press(screen.getByRole('button', { name: 'Search all notes' }));
    const sheet = await screen.findByTestId('search-sheet');
    await fireEvent.changeText(within(sheet).getByLabelText('Search'), 'dentist');
    const hit = await within(sheet).findByTestId('search-hit');
    expect(hit.props.accessibilityLabel).toBe('Weekly goal, Week of Nov 15 – 21, 2026: Book the dentist');
  });
});

describe('habit history', () => {
  test('a habit’s panel shows its last four weeks and its best streak', async () => {
    // Meditate done on six of the last seven days, missing Tuesday.
    for (const d of ['2026-11-15', '2026-11-16', '2026-11-18', '2026-11-19', '2026-11-20']) {
      await seedDay(d, { habitsDone: ['core-mindful'] });
    }
    await seedDay('2026-11-14', { water: 3 }); // the first day anything was logged
    await seedDay('2026-11-17', { water: 2 });
    await launch();
    await fireEvent.press(screen.getByRole('button', { name: 'Edit Meditate for 10 minutes' }));
    const history = screen.getByTestId('habit-history');
    // Nov 14–20 planned (today, not ticked yet, isn't counted): done on 5 of 7.
    expect(within(history).getByTestId('habit-history-summary')).toHaveTextContent('5 of 7 planned days · 71%');
    expect(within(history).getByTestId('habit-history-best')).toHaveTextContent('Longest streak in 60 days: 3 days');
    expect(within(history).getByTestId('history-2026-11-17-missed')).toBeOnTheScreen();
    expect(within(history).getByTestId('history-2026-11-21-today')).toBeOnTheScreen();
    expect(within(history).getByTestId('history-2026-11-13-before')).toBeOnTheScreen();
    expect(history.props.accessibilityLabel).toBe(
      'Last 4 weeks: 5 of 7 planned days · 71%. Longest streak in 60 days: 3 days.',
    );

    // Ticking today adds to it.
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Meditate for 10 minutes' }));
    expect(screen.getByTestId('habit-history-summary')).toHaveTextContent('6 of 8 planned days · 75%');
    expect(screen.getByTestId('habit-history-best')).toHaveTextContent('Longest streak in 60 days: 4 days');
  });

  test('a custom habit starts its record on the day it was added', async () => {
    await seed(SETTINGS_KEY, { ...DEFAULT_SETTINGS, mockPremium: true });
    await seedDay('2026-11-01', { water: 3 });
    await launch();
    await fireEvent.press(screen.getByRole('button', { name: 'Add a custom habit' }));
    await fireEvent.changeText(screen.getByLabelText('New habit name'), 'Stretch');
    await fireEvent.press(screen.getByRole('button', { name: 'Add habit' }));
    await advance(1000);
    expect((await loadHabits()).find((h) => h.label === 'Stretch')?.since).toBe('2026-11-21');
    expect(isSealed((await AsyncStorage.getItem(HABITS_KEY))!)).toBe(true);

    await fireEvent.press(screen.getByRole('button', { name: 'Edit Stretch' }));
    expect(screen.getByTestId('habit-history-summary')).toHaveTextContent('Nothing to count yet');
    expect(screen.getByTestId('history-2026-11-20-before')).toBeOnTheScreen();
  });
});

describe('month calendar mood', () => {
  test('the calendar can be shaded by mood instead of habits', async () => {
    await seed(SETTINGS_KEY, { ...DEFAULT_SETTINGS, mockPremium: true });
    await seedDay('2026-11-19', { mood: 5 });
    await seedDay('2026-11-20', { mood: 2, habitsDone: ['core-read'] });
    await launch();
    const cal = within(screen.getByTestId('month-calendar'));
    expect(cal.getByLabelText('November 20, 2026: 1 of 4 habits done')).toBeOnTheScreen();
    expect(cal.getByLabelText('November 19, 2026: no habits done')).toHaveStyle({ backgroundColor: colors.cardRaised });
    expect(cal.getByRole('radio', { name: 'Shade by habits done' })).toBeChecked();

    await fireEvent.press(cal.getByRole('radio', { name: 'Shade by mood' }));
    expect(cal.getByRole('radio', { name: 'Shade by mood' })).toBeChecked();
    expect(cal.getByLabelText('November 19, 2026: mood Great')).toHaveStyle({ backgroundColor: colors.mood });
    expect(cal.getByLabelText('November 20, 2026: mood Low')).toBeOnTheScreen();
    expect(cal.getByLabelText('Today, November 21, 2026: no mood logged')).toBeOnTheScreen();
    expect(cal.getByTestId('calendar-legend')).toHaveTextContent(/Mood each day.*Rough.*Great/);
    // The month's usual mood: the mean of 5 and 2 is 3.5, "Good" when rounded.
    expect(cal.getByLabelText('November, Usual mood: Good')).toBeOnTheScreen();

    await fireEvent.press(cal.getByRole('radio', { name: 'Shade by habits done' }));
    expect(cal.getByTestId('calendar-legend')).toHaveTextContent(/Habits done each day/);
  });
});
