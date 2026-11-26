import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { dateKey, lastNDays, longDate, parseDateKey, weekdayName } from '../src/lib/date';
import { COUNTDOWNS_KEY, dayStorageKey, loadCountdowns, loadHabits } from '../src/lib/storage';
import HomeScreen from '../src/screens/HomeScreen';

// These tests render the whole app; the first in the file also pays for a
// cold module load (see HomeScreen.test.tsx).
jest.setTimeout(30_000);

jest.mock('../src/lib/premium', () => ({
  ...jest.requireActual('../src/lib/premium'),
  purchasePremiumMock: jest.fn(async () => true),
}));

const Sharing = jest.requireMock('expo-sharing');
const Files = jest.requireMock('expo-file-system');

const today = () => dateKey();
const plusDays = (n: number) => {
  const t = parseDateKey(today());
  return dateKey(new Date(t.getFullYear(), t.getMonth(), t.getDate() + n));
};
const shortDate = (key: string) => `${weekdayName(parseDateKey(key)).slice(0, 3)}, ${longDate(parseDateKey(key))}`;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  Files.__files.clear();
});

async function launch() {
  await render(<HomeScreen />);
  await screen.findByText('Quick Capture');
}

async function goPremium() {
  await fireEvent.press(screen.getByRole('button', { name: 'Go Premium' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Unlock Premium for $4.99' }));
  await screen.findByText('Premium');
}

async function openSettings() {
  await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
  return screen.findByTestId('settings');
}

describe('coming up', () => {
  test('add a countdown two weeks out; it is saved sealed, removable, and undo brings it back', async () => {
    await launch();
    await fireEvent.press(screen.getByRole('button', { name: 'Add a date to count down to' }));
    await fireEvent.changeText(screen.getByLabelText('Countdown name'), 'Lisbon trip');
    expect(screen.getByTestId('countdown-offset')).toHaveTextContent('7 days');
    await fireEvent.press(screen.getByRole('button', { name: 'One week later' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Add countdown' }));

    const label = `Lisbon trip, ${shortDate(plusDays(14))}: 14 days`;
    expect(screen.getByLabelText(label)).toBeOnTheScreen();
    await waitFor(async () => expect(await loadCountdowns()).toEqual([expect.objectContaining({ label: 'Lisbon trip', date: plusDays(14) })]));
    expect(await AsyncStorage.getItem(COUNTDOWNS_KEY)).not.toContain('Lisbon');

    await fireEvent.press(screen.getByRole('button', { name: 'Remove Lisbon trip' }));
    expect(screen.queryByLabelText(label)).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByLabelText(label)).toBeOnTheScreen();
  });

  test('today and tomorrow read as words; a countdown cannot be added without a name', async () => {
    await launch();
    await fireEvent.press(screen.getByRole('button', { name: 'Add a date to count down to' }));
    expect(screen.getByRole('button', { name: 'Add countdown' })).toBeDisabled();
    for (let i = 0; i < 6; i++) await fireEvent.press(screen.getByRole('button', { name: 'One day sooner' }));
    expect(screen.getByTestId('countdown-offset')).toHaveTextContent('Tomorrow');
    await fireEvent.press(screen.getByRole('button', { name: 'One day sooner' }));
    expect(screen.getByTestId('countdown-offset')).toHaveTextContent('Today');
    expect(screen.getByRole('button', { name: 'One day sooner' })).toBeDisabled();
  });
});

describe('insights (Premium)', () => {
  test('locked for free users; with enough days, a sleep pattern is described', async () => {
    const dates = lastNDays(today(), 13).slice(0, 12); // the 12 days before today
    await AsyncStorage.multiSet(
      dates.map((d, i) => [dayStorageKey(d), JSON.stringify({ sleep: i % 2 ? 5 : 8, energy: i % 2 ? 4 : 8 })]),
    );
    await launch();
    expect(screen.getByRole('button', { name: 'Unlock insights with Premium' })).toBeOnTheScreen();
    await goPremium();
    expect(within(screen.getByTestId('insight-sleep-energy')).getByText(
      'After 7 or more hours of sleep, your energy averaged 8.0 out of 10, against 4.0 after less.',
    )).toBeOnTheScreen();
  });

  test('with too little logged, it says what it needs', async () => {
    await launch();
    await goPremium();
    expect(screen.getByTestId('insights-empty')).toBeOnTheScreen();
  });
});

describe('expenses as CSV', () => {
  test('Settings exports every expense as a spreadsheet through the share sheet', async () => {
    const yesterday = lastNDays(today(), 2)[0];
    await AsyncStorage.setItem(
      dayStorageKey(yesterday),
      JSON.stringify({ expenses: [{ id: 'e', cents: 1250, label: '=cmd|calc', category: 'food', createdAt: 1 }] }),
    );
    await launch();
    await openSettings();
    await fireEvent.press(screen.getByRole('button', { name: 'Export expenses as a spreadsheet' }));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
    const [uri, opts] = Sharing.shareAsync.mock.calls[0];
    expect(opts.mimeType).toBe('text/csv');
    expect(uri).toMatch(/personal-daily-hub-expenses-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv: string = Files.__files.get(uri);
    expect(csv).toContain('Date,Time,Amount,Category,Label');
    expect(csv).toContain(`${yesterday},`);
    expect(csv).toContain(",12.50,Food,'=cmd|calc"); // never runs as a formula
  });

  test('with no expenses, it says so instead of sharing an empty file', async () => {
    await launch();
    await openSettings();
    await fireEvent.press(screen.getByRole('button', { name: 'Export expenses as a spreadsheet' }));
    expect(await screen.findByText('There are no expenses to export yet.')).toBeOnTheScreen();
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });
});

describe('renaming a custom habit', () => {
  test('edit the name with its days; a name already taken is refused', async () => {
    await launch();
    await goPremium();
    await fireEvent.press(screen.getByRole('button', { name: 'Add a custom habit' }));
    await fireEvent.changeText(screen.getByLabelText('New habit name'), 'Stretch');
    await fireEvent.press(screen.getByRole('button', { name: 'Add habit' }));

    await fireEvent.press(screen.getByRole('button', { name: 'Edit Stretch' }));
    await fireEvent.changeText(screen.getByLabelText('Habit name'), 'read 20 pages');
    await fireEvent.press(screen.getByRole('button', { name: 'Done editing habit' }));
    expect(screen.getByText('You already have that habit.')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText('Habit name'), 'Stretch for 5 minutes');
    await fireEvent.press(screen.getByRole('button', { name: 'Done editing habit' }));
    expect(screen.getByRole('checkbox', { name: 'Stretch for 5 minutes' })).toBeOnTheScreen();
    await waitFor(async () => expect((await loadHabits()).map((h) => h.label)).toContain('Stretch for 5 minutes'));
    // Core habits have no name field.
    await fireEvent.press(screen.getByRole('button', { name: 'Edit Read 20 pages' }));
    expect(screen.queryByLabelText('Habit name')).not.toBeOnTheScreen();
  });
});
