import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { isSealed } from '../src/lib/codec';
import { FOCUS_TIMER_KEY, HABITS_KEY, loadDays, loadHabits } from '../src/lib/storage';
import HomeScreen from '../src/screens/HomeScreen';

// These tests render the whole app; the first pays for a cold module load.
jest.setTimeout(30_000);

const N = jest.requireMock('expo-notifications');
const D = '2026-11-18'; // a Wednesday
const MIN = 60_000;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  N.__scheduled.clear();
  jest.useFakeTimers({ now: new Date(2026, 10, 18, 9, 0) });
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

/** The home screen's cards, top to bottom, by test id. */
const cardOrder = () => screen.getAllByTestId(/^(card-|today-focus$)/).map((el) => el.props.testID as string);

async function openSettings() {
  await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
  return screen.findByTestId('settings');
}

describe('the focus timer', () => {
  test('runs for the set length, then logs it to today and says so', async () => {
    await launch();
    expect(screen.getByTestId('focus-minutes')).toHaveTextContent('No focus sessions yet today');
    await fireEvent.press(screen.getByRole('button', { name: 'Start a 25-minute focus session' }));
    expect(screen.getByTestId('focus-clock')).toHaveTextContent('25:00');
    await advance(0);
    expect(N.__scheduled.get('pdh-focus-end').trigger.date).toBe(new Date(2026, 10, 18, 9, 25).getTime());

    await advance(10 * MIN);
    expect(screen.getByTestId('focus-clock')).toHaveTextContent('15:00');

    await advance(15 * MIN + 1000);
    expect(screen.queryByTestId('focus-clock')).not.toBeOnTheScreen();
    expect(screen.getByText('Focus session done: 25 min. Time for a short break.')).toBeOnTheScreen();
    expect(screen.getByTestId('focus-minutes')).toHaveTextContent('Focused for 25 min today');
    expect(N.__scheduled.has('pdh-focus-end')).toBe(false);
    await advance(1000);
    expect((await loadDays([D]))[D].focusMinutes).toBe(25);
  });

  test('stopping early keeps the whole minutes done', async () => {
    await launch();
    await fireEvent.press(screen.getByRole('button', { name: 'Start a 25-minute focus session' }));
    await advance(10.5 * MIN);
    await fireEvent.press(screen.getByRole('button', { name: 'Stop the focus session' }));
    expect(screen.getByText('Stopped early: 10 min of focus kept.')).toBeOnTheScreen();
    expect(screen.getByTestId('focus-minutes')).toHaveTextContent('Focused for 10 min today');
    await advance(0);
    expect(N.__scheduled.size).toBe(0);
  });

  test('a session survives the app closing, sealed in storage, and is logged when the app comes back after it ended', async () => {
    const first = await launch();
    await fireEvent.press(screen.getByRole('button', { name: 'Start a 25-minute focus session' }));
    await advance(1000);
    const stored = await AsyncStorage.getItem(FOCUS_TIMER_KEY);
    expect(stored && isSealed(stored)).toBe(true);
    await first.unmount();

    // Reopened five minutes in: still running.
    jest.setSystemTime(new Date(2026, 10, 18, 9, 5));
    const second = await launch();
    expect(screen.getByTestId('focus-clock')).toHaveTextContent('20:00');
    await second.unmount();

    // Reopened after it ended.
    jest.setSystemTime(new Date(2026, 10, 18, 10, 0));
    await launch();
    expect(await screen.findByText('Focus session done: 25 min. Time for a short break.')).toBeOnTheScreen();
    expect(screen.getByTestId('focus-minutes')).toHaveTextContent('Focused for 25 min today');
  });

  test('the session length is set in Settings', async () => {
    await launch();
    await openSettings();
    await fireEvent.press(screen.getByRole('button', { name: 'Increase focus session length' }));
    expect(screen.getByTestId('focus-length-value')).toHaveTextContent('45 min');
    await fireEvent.press(screen.getByRole('button', { name: 'Close settings' }));
    expect(screen.getByRole('button', { name: 'Start a 45-minute focus session' })).toBeOnTheScreen();
  });

  test('an earlier day shows its focus time but has no timer', async () => {
    await launch();
    await fireEvent.press(screen.getByRole('button', { name: 'Start a 25-minute focus session' }));
    await advance(25 * MIN + 1000);
    jest.setSystemTime(new Date(2026, 10, 19, 9, 0));
    await advance(61_000); // the clock notices it is Thursday
    expect(screen.getByRole('button', { name: 'Start a 25-minute focus session' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Log the day before' }));
    expect(screen.queryByRole('button', { name: /focus session/ })).not.toBeOnTheScreen();
    expect(screen.getByTestId('focus-minutes')).toHaveTextContent('Focused for 25 min yesterday');
  });
});

describe('skipping a habit', () => {
  test('skip it for today: it moves aside, stops counting, and ticking it takes it back', async () => {
    await launch();
    const habits = () => within(screen.getByTestId('card-habits'));
    await fireEvent.press(screen.getByRole('button', { name: 'Edit Read 20 pages' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Skip Read 20 pages today' }));
    expect(screen.getByText('Skipped “Read 20 pages” today. Its streak carries on.')).toBeOnTheScreen();
    expect(habits().getByLabelText('0 of 3 habits done')).toBeOnTheScreen();
    expect(habits().getByText('Not today')).toBeOnTheScreen();
    expect(habits().getByRole('checkbox', { name: 'Read 20 pages, skipped today' })).toBeOnTheScreen();
    await advance(1000);
    expect((await loadDays([D]))[D].habitsSkipped).toEqual(['core-read']);

    await fireEvent.press(habits().getByRole('checkbox', { name: 'Read 20 pages, skipped today' }));
    expect(habits().getByLabelText('1 of 4 habits done')).toBeOnTheScreen();
    await advance(1000);
    expect((await loadDays([D]))[D]).toMatchObject({ habitsDone: ['core-read'], habitsSkipped: [] });
  });

  test('a habit not meant for the day has nothing to skip', async () => {
    await launch();
    await fireEvent.press(screen.getByRole('button', { name: 'Edit Plan tomorrow' }));
    // Thursdays only; today is a Wednesday.
    for (const day of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Friday', 'Saturday']) {
      await fireEvent.press(within(screen.getByTestId('day-picker')).getByRole('checkbox', { name: day }));
    }
    expect(screen.queryByRole('button', { name: /^Skip Plan tomorrow/ })).not.toBeOnTheScreen();
  });
});

describe('reordering habits', () => {
  test('move a habit up and it stays there after a restart', async () => {
    const view = await launch();
    const order = () =>
      within(screen.getByTestId('card-habits'))
        .getAllByRole('checkbox')
        .map((el) => el.props.accessibilityLabel as string);
    await fireEvent.press(screen.getByRole('button', { name: 'Edit Plan tomorrow' }));
    expect(screen.getByRole('button', { name: 'Move Plan tomorrow down' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Move Plan tomorrow up' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Move Plan tomorrow up' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Move Plan tomorrow up' }));
    expect(screen.getByRole('button', { name: 'Move Plan tomorrow up' })).toBeDisabled();
    // The day toggles are checkboxes too; only the habits' own are checked here.
    expect(order().filter((l) => !/day$/.test(l))).toEqual([
      'Plan tomorrow',
      'Move for 30 minutes',
      'Read 20 pages',
      'Meditate for 10 minutes',
    ]);
    await advance(1000);
    expect((await loadHabits()).map((h) => h.id)).toEqual(['core-plan', 'core-move', 'core-read', 'core-mindful']);
    expect(isSealed((await AsyncStorage.getItem(HABITS_KEY))!)).toBe(true);
    await view.unmount();

    await launch();
    expect(order()).toEqual(['Plan tomorrow', 'Move for 30 minutes', 'Read 20 pages', 'Meditate for 10 minutes']);
  });
});

describe('arranging the home screen', () => {
  test('hide a card, move one, and reset', async () => {
    await launch();
    const all = ['today-focus', 'card-week', 'card-notes', 'card-habits', 'card-water', 'card-expenses', 'card-journal', 'card-countdowns', 'card-insights', 'card-history'];
    expect(cardOrder()).toEqual(all);

    await openSettings();
    await fireEvent.press(screen.getByRole('button', { name: 'Arrange the home screen' }));
    await fireEvent(screen.getByLabelText('Show Journal'), 'valueChange', false);
    await fireEvent.press(screen.getByRole('button', { name: 'Move History up' }));
    expect(cardOrder()).toEqual(all.filter((c) => c !== 'card-journal' && c !== 'card-history').toSpliced(7, 0, 'card-history'));

    await fireEvent.press(screen.getByRole('button', { name: 'Reset the home screen' }));
    expect(cardOrder()).toEqual(all);
  });

  test('with every card off, the screen says how to bring them back', async () => {
    await launch();
    await openSettings();
    await fireEvent.press(screen.getByRole('button', { name: 'Arrange the home screen' }));
    for (const label of ['Today’s focus', 'This week', 'Quick Capture', 'Habits', 'Wellbeing', 'Expenses', 'Journal', 'On this day', 'Coming up', 'Insights', 'History']) {
      await fireEvent(screen.getByLabelText(`Show ${label}`), 'valueChange', false);
    }
    await fireEvent.press(screen.getByRole('button', { name: 'Done arranging' }));
    expect(screen.getByTestId('arrange-home')).toHaveTextContent(/0 of 11 cards showing/);
    await fireEvent.press(screen.getByRole('button', { name: 'Close settings' }));
    expect(screen.getByText('Every card is switched off.')).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/^card-/)).toHaveLength(0);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose cards in Settings' }));
    expect(await screen.findByTestId('settings')).toBeOnTheScreen();
  });
});

describe('water pace', () => {
  test('says how today’s water compares with the clock', async () => {
    jest.setSystemTime(new Date(2026, 10, 18, 14, 0));
    await launch();
    expect(screen.getByTestId('water-hint')).toHaveTextContent('8 to go · 4 behind pace');
    for (let i = 0; i < 4; i++) await fireEvent.press(screen.getByRole('button', { name: 'Add a glass of water' }));
    expect(screen.getByTestId('water-hint')).toHaveTextContent('4 to go · on pace');
    // Not for an earlier day: the clock says nothing about it.
    await fireEvent.press(screen.getByRole('button', { name: 'Log the day before' }));
    expect(screen.getByTestId('water-hint')).toHaveTextContent(/^8 to go$/);
  });
});

describe('Premium is remembered', () => {
  // The real clock here: the mock purchase and the paywall's animation wait on it.
  beforeEach(() => jest.useRealTimers());

  async function unlock() {
    await fireEvent.press(screen.getByRole('button', { name: 'Go Premium' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Unlock Premium for $4.99' }));
    expect(await screen.findByLabelText('Premium is active')).toBeOnTheScreen();
  }

  test('an unlock survives the app being closed, and is stored sealed', async () => {
    const first = await launch();
    await unlock();
    await waitFor(async () => {
      const stored = await AsyncStorage.getItem('pdh:v1:settings');
      expect(stored && isSealed(stored)).toBe(true);
    });
    await first.unmount();

    await launch();
    expect(screen.getByLabelText('Premium is active')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Go Premium' })).not.toBeOnTheScreen();
  });

  test('Settings can turn it off, to try the free version again', async () => {
    await launch();
    await openSettings();
    expect(screen.queryByTestId('premium-off')).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Close settings' }));
    await unlock();
    await openSettings();
    await fireEvent.press(screen.getByRole('button', { name: 'Turn off Premium' }));
    expect(screen.queryByTestId('premium-off')).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Close settings' }));
    expect(screen.getByRole('button', { name: 'Go Premium' })).toBeOnTheScreen();
  });

  test('Erase everything clears it', async () => {
    await launch();
    await unlock();
    await openSettings();
    await fireEvent.press(screen.getByRole('button', { name: 'Erase all data' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Erase everything' }));
    expect(await screen.findByText('Everything on this phone has been erased.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Go Premium' })).toBeOnTheScreen();
  });
});
