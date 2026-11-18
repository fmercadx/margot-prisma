import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { createDataCodec } from '../src/lib/dataCodec';
import { dateKey, lastNDays, longDate, parseDateKey } from '../src/lib/date';
import { dayStorageKey, loadDays, loadSettings } from '../src/lib/storage';
import HomeScreen from '../src/screens/HomeScreen';

// These tests render the whole app; the first in the file also pays for a
// cold module load (see HomeScreen.test.tsx).
jest.setTimeout(30_000);

jest.mock('../src/lib/premium', () => ({
  ...jest.requireActual('../src/lib/premium'),
  purchasePremiumMock: jest.fn(async () => true),
}));

const SecureStore = jest.requireMock('expo-secure-store');
const Auth = jest.requireMock('expo-local-authentication');
const Notifications = jest.requireMock('expo-notifications');

const KEY_NAME = 'pdh.dataKey.v1';
const today = () => dateKey();
const daysAgo = (n: number) => lastNDays(today(), n + 1)[0];
const settle = () => new Promise((r) => setTimeout(r, 400)); // past the 300 ms save debounce

beforeEach(async () => {
  await AsyncStorage.clear();
  SecureStore.__items.clear();
  Notifications.__scheduled.clear();
  Auth.__state.level = 3;
  Auth.__state.result = { success: true };
  jest.clearAllMocks();
});

async function launch() {
  await render(<HomeScreen />);
  await screen.findByText('Quick Capture');
}

async function addNote(text: string) {
  await fireEvent.changeText(screen.getByLabelText('New note'), text);
  await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));
}

async function addExpense(amount: string, label: string, category?: string) {
  if (category) await fireEvent.press(screen.getByRole('radio', { name: `Category: ${category}` }));
  await fireEvent.changeText(screen.getByLabelText('Amount in dollars'), amount);
  await fireEvent.changeText(screen.getByLabelText('What the expense was for (optional)'), label);
  await fireEvent.press(screen.getByRole('button', { name: 'Add expense' }));
}

async function openSettings() {
  await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
  return screen.findByTestId('settings');
}

const closeSettings = async () =>
  fireEvent.press(screen.getAllByRole('button', { name: 'Close settings' }).at(-1)!);

describe("today's focus", () => {
  test('set it, change it, clear it: each is saved for today', async () => {
    await launch();
    await fireEvent.press(screen.getByRole('button', { name: 'Set today’s focus' }));
    await fireEvent.changeText(screen.getByLabelText('Today’s focus'), '  Ship the report ');
    await fireEvent.press(screen.getByRole('button', { name: 'Save focus' }));

    expect(screen.getByTestId('focus-text')).toHaveTextContent('Ship the report');
    await waitFor(async () => expect((await loadDays([today()]))[today()]?.focus).toBe('Ship the report'));

    await fireEvent.press(screen.getByRole('button', { name: 'Today’s focus: Ship the report. Tap to change it' }));
    await fireEvent.changeText(screen.getByLabelText('Today’s focus'), '');
    await fireEvent.press(screen.getByRole('button', { name: 'Save focus' }));
    expect(screen.getByRole('button', { name: 'Set today’s focus' })).toBeOnTheScreen();
    await waitFor(async () => expect((await loadDays([today()]))[today()]?.focus).toBe(''));
  });

  test('cancel keeps what was there', async () => {
    await launch();
    await fireEvent.press(screen.getByRole('button', { name: 'Set today’s focus' }));
    await fireEvent.changeText(screen.getByLabelText('Today’s focus'), 'Never mind');
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel focus' }));
    expect(screen.getByRole('button', { name: 'Set today’s focus' })).toBeOnTheScreen();
  });
});

describe('expense categories', () => {
  test('each expense is filed under the chosen category, and the breakdown compares them', async () => {
    await launch();
    expect(screen.getByRole('radio', { name: 'Category: Other' })).toBeChecked();

    await addExpense('12.50', 'Tacos', 'Food');
    // The category stays chosen for the next one.
    expect(screen.getByRole('radio', { name: 'Category: Food' })).toBeChecked();
    expect(screen.queryByTestId('expense-breakdown')).not.toBeOnTheScreen(); // one category: nothing to compare

    await addExpense('4', '', 'Transport');
    expect(screen.getByTestId('expense-total')).toHaveTextContent('$16.50');
    expect(screen.getByTestId('expense-breakdown')).toBeOnTheScreen();
    expect(screen.getByLabelText('Food: $12.50, 76%')).toBeOnTheScreen();
    expect(screen.getByLabelText('Transport: $4.00, 24%')).toBeOnTheScreen();
    // An unlabelled expense goes by its category.
    expect(screen.getByRole('button', { name: 'Delete transport expense $4.00' })).toBeOnTheScreen();

    await waitFor(async () =>
      expect((await loadDays([today()]))[today()]?.expenses.map((e) => [e.label, e.category])).toEqual([
        ['', 'transport'],
        ['Tacos', 'food'],
      ]),
    );
  });
});

describe('daily budget', () => {
  test('set in Settings; Expenses then shows what is left, and how far over', async () => {
    await launch();
    expect(screen.queryByTestId('budget')).not.toBeOnTheScreen();

    await openSettings();
    expect(screen.getByTestId('daily-budget-value')).toHaveTextContent('Off');
    expect(screen.getByRole('button', { name: 'Decrease daily budget' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Increase daily budget' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Increase daily budget' }));
    expect(screen.getByTestId('daily-budget-value')).toHaveTextContent('$15');
    await closeSettings();
    await waitFor(async () => expect((await loadSettings()).dailyBudgetCents).toBe(1500));

    expect(screen.getByTestId('budget-text')).toHaveTextContent('$15.00 left of $15.00');
    await addExpense('9.25', 'Lunch');
    expect(screen.getByTestId('budget-text')).toHaveTextContent('$5.75 left of $15.00');
    await addExpense('10', 'Cinema');
    expect(screen.getByTestId('budget-text')).toHaveTextContent('$4.25 over your $15.00 budget');
  });
});

describe('search', () => {
  test('finds notes from every stored day, decrypted on the phone, older ones included', async () => {
    await AsyncStorage.multiSet([
      [dayStorageKey(daysAgo(3)), JSON.stringify({ notes: [{ id: 'a', text: 'Passport photos taken', createdAt: 1 }] })],
      // Far older than the 60 days the app keeps in memory.
      [dayStorageKey(daysAgo(300)), JSON.stringify({ focus: 'Renew the passport', notes: [] })],
      [dayStorageKey(daysAgo(5)), JSON.stringify({ expenses: [{ id: 'e', cents: 13000, label: 'Passport fee', createdAt: 2 }] })],
    ]);
    await launch();
    // Launch sealed those plain values: storage holds no readable text.
    expect(await AsyncStorage.getItem(dayStorageKey(daysAgo(300)))).not.toContain('passport');
    await addNote('Find passport case');

    await fireEvent.press(screen.getByRole('button', { name: 'Search all notes' }));
    const sheet = await screen.findByTestId('search-sheet');
    await fireEvent.changeText(within(sheet).getByLabelText('Search'), 'PASSPORT');

    expect(await within(sheet).findByText('4 matches')).toBeOnTheScreen();
    const hits = within(sheet).getAllByTestId('search-hit');
    expect(hits.map((h) => h.props.accessibilityLabel.split(':')[0].split(',')[0])).toEqual(['Note', 'Note', 'Expense', 'Focus']);
    expect(hits[3].props.accessibilityLabel).toContain(longDate(parseDateKey(daysAgo(300))));

    await fireEvent.changeText(within(sheet).getByLabelText('Search'), 'zebra');
    expect(within(sheet).getByTestId('search-empty')).toHaveTextContent('Nothing matches “zebra”.');

    await fireEvent.press(within(sheet).getByRole('button', { name: 'Close search' }));
    expect(screen.queryByTestId('search-sheet')).not.toBeOnTheScreen();
  });
});

describe('month calendar (Premium)', () => {
  test('shades each day by habits done, opens a day, and steps back a month', async () => {
    await launch();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Read 20 pages' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Plan tomorrow' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Go Premium' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Unlock Premium for $4.99' }));
    await screen.findByText('Premium');

    const cal = screen.getByTestId('month-calendar');
    const label = `Today, ${longDate(parseDateKey(today()))}: 2 of 4 habits done`;
    const cell = within(cal).getByLabelText(label);
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();

    await fireEvent.press(cell);
    expect(await screen.findByTestId('day-sheet')).toBeOnTheScreen();
    expect(screen.getByTestId('day-sheet-title')).toHaveTextContent('Today');
    await fireEvent.press(screen.getByRole('button', { name: 'Close day' }));

    const title = screen.getByTestId('month-title').props.children;
    await fireEvent.press(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByTestId('month-title')).not.toHaveTextContent(title);
    await fireEvent.press(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByTestId('month-title')).toHaveTextContent(title);
  });
});

describe('erase everything', () => {
  async function eraseFromSettings() {
    await openSettings();
    await fireEvent.press(screen.getByRole('button', { name: 'Erase all data' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Erase everything' }));
  }

  test('asks first; then deletes every stored value and destroys the key', async () => {
    await launch();
    await addNote('Bank PIN hint');
    await waitFor(async () => expect(await AsyncStorage.getItem(dayStorageKey(today()))).not.toBeNull());
    const oldKey = SecureStore.__items.get(KEY_NAME);
    const oldCiphertext = (await AsyncStorage.getItem(dayStorageKey(today())))!;

    // "Keep my data" backs out with nothing touched.
    await openSettings();
    await fireEvent.press(screen.getByRole('button', { name: 'Erase all data' }));
    expect(screen.getByTestId('erase-confirm-panel')).toHaveTextContent(/encryption key is destroyed/);
    await fireEvent.press(screen.getByRole('button', { name: 'Keep my data' }));
    expect(screen.queryByTestId('erase-confirm-panel')).not.toBeOnTheScreen();
    await closeSettings();
    expect(await AsyncStorage.getItem(dayStorageKey(today()))).toBe(oldCiphertext);

    await eraseFromSettings();
    expect(await screen.findByText('Everything on this phone has been erased.')).toBeOnTheScreen();
    expect(screen.queryByText('Bank PIN hint')).not.toBeOnTheScreen();
    await settle();
    expect((await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('pdh:'))).toEqual([]);

    // A new key, and the old ciphertext (say, from a copy of the database
    // taken earlier) can no longer be opened.
    const newKey = SecureStore.__items.get(KEY_NAME);
    expect(newKey).toBeTruthy();
    expect(newKey).not.toBe(oldKey);
    const codec = await createDataCodec();
    await expect(codec.open(dayStorageKey(today()), oldCiphertext)).rejects.toThrow();

    // And the app carries on, saving under the new key.
    await addNote('Fresh start');
    await waitFor(async () => expect((await loadDays([today()]))[today()]?.notes[0].text).toBe('Fresh start'));
    expect(await AsyncStorage.getItem(dayStorageKey(today()))).not.toContain('Fresh start');
  });

  test('with app lock on, it needs the owner; a dismissed prompt erases nothing', async () => {
    await AsyncStorage.setItem('pdh:v1:settings', JSON.stringify({ lockEnabled: true }));
    await launch(); // the launch prompt succeeds
    await addNote('Keep me safe');
    await waitFor(async () => expect((await loadDays([today()]))[today()]?.notes).toHaveLength(1));
    const key = SecureStore.__items.get(KEY_NAME);

    Auth.__state.result = { success: false, error: 'user_cancel' };
    await eraseFromSettings();
    await settle();
    expect(Auth.authenticateAsync).toHaveBeenLastCalledWith(expect.objectContaining({ promptMessage: 'Confirm to erase all data' }));
    expect((await loadDays([today()]))[today()]?.notes).toHaveLength(1);
    expect(SecureStore.__items.get(KEY_NAME)).toBe(key);

    Auth.__state.result = { success: true };
    await fireEvent.press(screen.getByRole('button', { name: 'Erase everything' }));
    expect(await screen.findByText('Everything on this phone has been erased.')).toBeOnTheScreen();
    expect(screen.queryByTestId('lock-screen')).not.toBeOnTheScreen();
    expect(await loadDays([today()])).toEqual({});
  });

  test('turns off the daily reminder too', async () => {
    await launch();
    await fireEvent.press(screen.getByRole('button', { name: 'Turn on the 8 PM daily reminder' }));
    await waitFor(() => expect(Notifications.__scheduled.size).toBe(1));

    await eraseFromSettings();
    await screen.findByText('Everything on this phone has been erased.');
    expect(Notifications.__scheduled.size).toBe(0);
    expect(screen.getByRole('button', { name: 'Turn on the 8 PM daily reminder' })).toBeOnTheScreen();
  });
});
