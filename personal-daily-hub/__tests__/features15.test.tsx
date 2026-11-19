import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { dateKey, lastNDays } from '../src/lib/date';
import { dayStorageKey, loadDays, loadHabits, loadSettings } from '../src/lib/storage';
import HomeScreen from '../src/screens/HomeScreen';

// These tests render the whole app; the first in the file also pays for a
// cold module load (see HomeScreen.test.tsx).
jest.setTimeout(30_000);

jest.mock('../src/lib/premium', () => ({
  ...jest.requireActual('../src/lib/premium'),
  purchasePremiumMock: jest.fn(async () => true),
}));

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const today = () => dateKey();
const daysAgo = (n: number) => lastNDays(today(), n + 1)[0];
const todayName = () => DAY_NAMES[new Date().getDay()];

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

async function launch() {
  const r = await render(<HomeScreen />);
  await screen.findByText('Quick Capture');
  return r;
}

async function appState(state: 'active' | 'background') {
  const listeners = (AppState.addEventListener as jest.Mock).mock.calls
    .filter(([event]) => event === 'change')
    .map(([, fn]) => fn);
  await act(async () => listeners.forEach((fn) => fn(state)));
}

describe('habit schedules', () => {
  test('taking today off moves a habit to "Not today", out of the count; it is saved', async () => {
    const first = await launch();
    const card = screen.getByTestId('card-habits');
    expect(within(card).getByLabelText('0 of 4 habits done')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Choose days for Move for 30 minutes' }));
    const picker = screen.getByTestId('day-picker');
    await fireEvent.press(within(picker).getByRole('checkbox', { name: todayName() }));
    // The habit (and its open picker) has moved down into "Not today".
    const moved = screen.getByTestId('day-picker');
    expect(within(moved).getByRole('checkbox', { name: todayName() })).not.toBeChecked();
    await fireEvent.press(screen.getByRole('button', { name: 'Done choosing days' }));

    expect(within(card).getByText('Not today')).toBeOnTheScreen();
    expect(within(card).getByLabelText('0 of 3 habits done')).toBeOnTheScreen();
    await waitFor(async () => {
      const move = (await loadHabits()).find((h) => h.id === 'core-move');
      expect(move?.days).toHaveLength(6);
      expect(move?.days).not.toContain(new Date().getDay());
    });

    // Still there after a restart.
    await first.unmount();
    await launch();
    expect(within(screen.getByTestId('card-habits')).getByText('Not today')).toBeOnTheScreen();
  });

  test('the last day left cannot be switched off', async () => {
    await launch();
    await fireEvent.press(screen.getByRole('button', { name: 'Choose days for Read 20 pages' }));
    const picker = screen.getByTestId('day-picker');
    for (const name of DAY_NAMES.filter((n) => n !== todayName())) {
      await fireEvent.press(within(picker).getByRole('checkbox', { name }));
    }
    const last = within(picker).getByRole('checkbox', { name: todayName() });
    expect(last).toBeChecked();
    expect(last).toBeDisabled();
  });
});

describe('journal', () => {
  test('write, save, and it is stored and searchable', async () => {
    await launch();
    expect(screen.getByRole('button', { name: 'Save journal' })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Journal entry'), 'Long walk by the river.\nFelt good.');
    expect(screen.getByText('Not saved yet')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Save journal' }));
    expect(screen.getByText('Saved')).toBeOnTheScreen();
    await waitFor(async () =>
      expect((await loadDays([today()]))[today()]?.journal).toBe('Long walk by the river.\nFelt good.'),
    );
    const raw = await AsyncStorage.getItem(dayStorageKey(today()));
    expect(raw).not.toContain('river'); // sealed like everything else

    await fireEvent.press(screen.getByRole('button', { name: 'Search all notes' }));
    const sheet = await screen.findByTestId('search-sheet');
    await fireEvent.changeText(within(sheet).getByLabelText('Search'), 'river');
    expect(await within(sheet).findByText('1 match')).toBeOnTheScreen();
    expect(within(sheet).getByTestId('search-hit').props.accessibilityLabel).toMatch(/^Journal, Today: /);
  });

  test('an unsaved entry is kept when the app goes to the background', async () => {
    await launch();
    await fireEvent.changeText(screen.getByLabelText('Journal entry'), 'Half a thought');
    await appState('background');
    await waitFor(async () => expect((await loadDays([today()]))[today()]?.journal).toBe('Half a thought'));
  });
});

describe('add again', () => {
  test('a recent expense is one tap away, with its label and category', async () => {
    await AsyncStorage.setItem(
      dayStorageKey(daysAgo(1)),
      JSON.stringify({ expenses: [{ id: 'y', cents: 450, label: 'Coffee', category: 'food', createdAt: 1 }] }),
    );
    await launch();
    await fireEvent.press(screen.getByRole('button', { name: 'Add again: Coffee, $4.50' }));
    expect(screen.getByTestId('expense-total')).toHaveTextContent('$4.50');
    await waitFor(async () =>
      expect((await loadDays([today()]))[today()]?.expenses[0]).toMatchObject({ label: 'Coffee', cents: 450, category: 'food' }),
    );
  });
});

describe('hide amounts', () => {
  test('masks every amount, is remembered, and can be undone', async () => {
    await AsyncStorage.setItem(
      dayStorageKey(today()),
      JSON.stringify({ expenses: [{ id: 'e', cents: 1250, label: 'Lunch', category: 'food', createdAt: 1 }] }),
    );
    const first = await launch();
    expect(screen.getByTestId('expense-total')).toHaveTextContent('$12.50');

    await fireEvent.press(screen.getByRole('button', { name: 'Hide amounts' }));
    expect(screen.getByTestId('expense-total')).toHaveTextContent('$•••');
    expect(screen.queryByText('$12.50')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Delete Lunch $•••' })).toBeOnTheScreen();
    await waitFor(async () => expect((await loadSettings()).hideAmounts).toBe(true));

    await first.unmount();
    await launch();
    expect(screen.getByTestId('expense-total')).toHaveTextContent('$•••');
    await fireEvent.press(screen.getByRole('button', { name: 'Show amounts' }));
    expect(screen.getByTestId('expense-total')).toHaveTextContent('$12.50');
  });

  test('history and day details are masked too (Premium)', async () => {
    await AsyncStorage.setItem(
      dayStorageKey(today()),
      JSON.stringify({ expenses: [{ id: 'e', cents: 1250, label: 'Lunch', category: 'food', createdAt: 1 }] }),
    );
    await AsyncStorage.setItem('pdh:v1:settings', JSON.stringify({ hideAmounts: true }));
    await launch();
    await fireEvent.press(screen.getByRole('button', { name: 'Go Premium' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Unlock Premium for $4.99' }));
    await screen.findByText('Premium');

    expect(within(screen.getByTestId('week-summary')).getByLabelText('Spent: $•••')).toBeOnTheScreen();
    expect(within(screen.getByTestId('month-summary')).getByLabelText(/Spent: \$•••$/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'See everything from today' }));
    const sheet = within(await screen.findByTestId('day-sheet'));
    expect(sheet.getByLabelText('Spent: $•••')).toBeOnTheScreen();
    expect(sheet.queryByText('$12.50')).not.toBeOnTheScreen();
  });
});
