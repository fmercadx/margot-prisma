import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import { isSealed } from '../src/lib/codec';
import { BILLS_KEY, dayStorageKey, loadDays, PINNED_KEY } from '../src/lib/storage';
import { EMPTY_DAY, type DayLog } from '../src/lib/store';
import HomeScreen from '../src/screens/HomeScreen';

// These tests render the whole app; the first pays for a cold module load.
jest.setTimeout(30_000);

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  jest.useFakeTimers({ now: new Date(2026, 10, 21, 9, 0) }); // a Saturday
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

async function addNote(text: string) {
  await fireEvent.changeText(screen.getByLabelText('New note'), text);
  await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));
}

async function openSettings() {
  await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
  return screen.findByTestId('settings');
}

/** Saved as an older build would have: plain JSON, sealed at the next launch. */
async function seedDay(date: string, day: Partial<DayLog>) {
  await AsyncStorage.setItem(dayStorageKey(date), JSON.stringify({ ...EMPTY_DAY, ...day }));
}

describe('pinned notes', () => {
  test('pin a note to every day; it stays after a restart; unpin puts it back', async () => {
    const view = await launch();
    await addNote('Gate code 4321');
    await fireEvent.press(screen.getByRole('button', { name: 'Pin to every day: Gate code 4321' }));
    expect(within(screen.getByTestId('pinned')).getByText('Gate code 4321')).toBeOnTheScreen();
    expect(screen.getByText('Nothing captured yet today.')).toBeOnTheScreen();
    await advance(1000);
    const stored = await AsyncStorage.getItem(PINNED_KEY);
    expect(stored && isSealed(stored)).toBe(true);
    await view.unmount();

    await launch();
    expect(within(screen.getByTestId('pinned')).getByText('Gate code 4321')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Unpin: Gate code 4321' }));
    expect(screen.queryByTestId('pinned')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Edit note: Gate code 4321' })).toBeOnTheScreen();
  });

  test('deleting a pinned note can be undone', async () => {
    await launch();
    await addNote('Wifi: hunter2');
    await fireEvent.press(screen.getByRole('button', { name: 'Pin to every day: Wifi: hunter2' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Delete pinned note: Wifi: hunter2' }));
    expect(screen.queryByTestId('pinned')).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    expect(within(screen.getByTestId('pinned')).getByText('Wifi: hunter2')).toBeOnTheScreen();
  });

  test('unpinning into a day that already has its three free notes asks for Premium', async () => {
    await launch();
    await addNote('Keep me');
    await fireEvent.press(screen.getByRole('button', { name: 'Pin to every day: Keep me' }));
    for (const t of ['One', 'Two', 'Three']) await addNote(t);
    await fireEvent.press(screen.getByRole('button', { name: 'Unpin: Keep me' }));
    expect(await screen.findByTestId('paywall')).toBeOnTheScreen();
    expect(within(screen.getByTestId('pinned')).getByText('Keep me')).toBeOnTheScreen();
  });
});

describe('monthly bills', () => {
  async function addRent() {
    const card = within(screen.getByTestId('card-expenses'));
    await fireEvent.changeText(card.getByLabelText('Amount in dollars'), '1200');
    await fireEvent.changeText(card.getByLabelText('What the expense was for (optional)'), 'Rent');
    await fireEvent.press(card.getByRole('checkbox', { name: 'Repeat on the 21st of every month' }));
    await fireEvent.press(card.getByRole('button', { name: 'Add expense' }));
  }

  test('repeat an expense monthly: next month it is added on its day, once', async () => {
    const first = await launch();
    await addRent();
    expect(screen.getByText('“Rent” will be added on the 21st of every month.')).toBeOnTheScreen();
    expect(screen.getByTestId('expense-total')).toHaveTextContent('$1,200.00');
    await advance(1000);
    expect(isSealed((await AsyncStorage.getItem(BILLS_KEY))!)).toBe(true);
    await first.unmount();

    // A month later.
    jest.setSystemTime(new Date(2026, 11, 21, 9, 0));
    const second = await launch();
    expect(await screen.findByText('Added this month’s “Rent” to your expenses.')).toBeOnTheScreen();
    expect(screen.getByTestId('expense-total')).toHaveTextContent('$1,200.00');
    await advance(1000);
    expect((await loadDays(['2026-12-21']))['2026-12-21'].expenses).toHaveLength(1);
    await second.unmount();

    // Opened again the same day: nothing added twice.
    await launch();
    await advance(1000);
    expect(screen.queryByText('Added this month’s “Rent” to your expenses.')).not.toBeOnTheScreen();
    expect((await loadDays(['2026-12-21']))['2026-12-21'].expenses).toHaveLength(1);
  });

  test('Settings lists the bill: change its day, stop it, undo', async () => {
    await launch();
    await addRent();
    await openSettings();
    const row = () => screen.getByTestId(/^bill-/);
    expect(row()).toHaveTextContent(/Rent.*on the 21st/);
    await fireEvent.press(screen.getByRole('button', { name: 'Earlier day for Rent' }));
    expect(row()).toHaveTextContent(/on the 20th/);
    await fireEvent.press(screen.getByRole('button', { name: 'Stop repeating Rent' }));
    expect(screen.queryByTestId(/^bill-/)).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Close settings' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    await openSettings();
    expect(row()).toHaveTextContent(/on the 20th/);
  });

  test('hide amounts covers the bill list too', async () => {
    await launch();
    await addRent();
    await fireEvent.press(screen.getByRole('button', { name: 'Hide amounts' }));
    await openSettings();
    expect(screen.getByTestId(/^bill-/)).not.toHaveTextContent(/1,200/);
  });
});

describe('on this day', () => {
  test('shows a week and a year ago; a day in memory opens in full', async () => {
    await seedDay('2026-11-14', { focus: 'Book the venue' });
    await seedDay('2025-11-21', { journal: 'First day at the new job.\nNervous.', gratitude: ['Kind team'] });
    await launch();
    const card = within(await screen.findByTestId('card-on-this-day'));
    expect(card.getByText('A week ago')).toBeOnTheScreen();
    expect(card.getByText('Book the venue')).toBeOnTheScreen();
    expect(await card.findByText('A year ago')).toBeOnTheScreen();
    expect(card.getByText('“First day at the new job.”')).toBeOnTheScreen();
    expect(card.getByText('Kind team')).toBeOnTheScreen();
    expect(card.queryByText('A month ago')).not.toBeOnTheScreen();

    // A year ago is read from storage just for this; it isn't a day to open.
    expect(card.queryByRole('button', { name: /^A year ago/ })).not.toBeOnTheScreen();
    await fireEvent.press(card.getByRole('button', { name: /^A week ago/ }));
    expect(await screen.findByTestId('day-sheet')).toBeOnTheScreen();
    expect(screen.getByTestId('day-sheet-title')).toHaveTextContent('Saturday');
  });

  test('with nothing written back then, the card stays out of the way', async () => {
    await seedDay('2026-11-14', { water: 6 });
    await launch();
    await advance(100);
    expect(screen.queryByTestId('card-on-this-day')).not.toBeOnTheScreen();
  });
});
