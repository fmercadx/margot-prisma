import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { dateKey } from '../src/lib/date';
import { FREE_NOTES_PER_DAY } from '../src/lib/premium';
import { dayStorageKey, HABITS_KEY } from '../src/lib/storage';
import HomeScreen from '../src/screens/HomeScreen';

// The mock purchase waits 600ms so its busy state shows on screen; here it
// resolves at once, so the unlock lands inside the press that caused it.
jest.mock('../src/lib/premium', () => ({
  ...jest.requireActual('../src/lib/premium'),
  purchasePremiumMock: jest.fn(async () => true),
}));

const storedDay = async (date = dateKey()) => {
  const raw = await AsyncStorage.getItem(dayStorageKey(date));
  return raw === null ? null : JSON.parse(raw);
};

async function addNote(text: string) {
  await fireEvent.changeText(screen.getByLabelText('New note'), text);
  await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

test('renders every module', async () => {
  await render(<HomeScreen />);
  expect(await screen.findByText('Quick Capture')).toBeOnTheScreen();
  expect(screen.getByText('Habits')).toBeOnTheScreen();
  expect(screen.getByText('Water & Energy')).toBeOnTheScreen();
  expect(screen.getByText('Expenses')).toBeOnTheScreen();
  expect(screen.getByText('Last 7 days')).toBeOnTheScreen();
  expect(screen.getAllByRole('checkbox')).toHaveLength(4);
});

test(`the ${FREE_NOTES_PER_DAY + 1}th note opens the paywall, and unlocking saves it`, async () => {
  await render(<HomeScreen />);
  await screen.findByText('Quick Capture');

  for (let i = 1; i <= FREE_NOTES_PER_DAY; i++) await addNote(`Note ${i}`);
  expect(screen.getByText('Note 3')).toBeOnTheScreen();
  expect(screen.queryByTestId('paywall')).not.toBeOnTheScreen();

  await addNote('Note 4');
  expect(await screen.findByTestId('paywall')).toBeOnTheScreen();
  expect(screen.getByText(/the free limit/)).toBeOnTheScreen();
  expect(screen.getByText('Unlimited entries')).toBeOnTheScreen();
  expect(screen.getByText('Historical graphs')).toBeOnTheScreen();
  expect(screen.getByText('Custom habits')).toBeOnTheScreen();
  // Blocked, not discarded: the draft is still in the box.
  expect(screen.queryByText('Note 4')).not.toBeOnTheScreen();
  expect(screen.getByLabelText('New note')).toHaveDisplayValue('Note 4');

  await fireEvent.press(screen.getByRole('button', { name: 'Unlock Premium for $4.99' }));

  expect(await screen.findByText('Note 4')).toBeOnTheScreen();
  expect(screen.queryByTestId('paywall')).not.toBeOnTheScreen();
  expect(screen.getByLabelText('New note')).toHaveDisplayValue('');
  expect(screen.getByText('Premium')).toBeOnTheScreen();

  // Premium has no cap.
  await addNote('Note 5');
  expect(screen.getByText('Note 5')).toBeOnTheScreen();

  await waitFor(async () => expect((await storedDay())?.notes).toHaveLength(5));
});

test('"Not now" dismisses the paywall without saving the note', async () => {
  await render(<HomeScreen />);
  await screen.findByText('Quick Capture');
  for (let i = 1; i <= FREE_NOTES_PER_DAY + 1; i++) await addNote(`Note ${i}`);
  await screen.findByTestId('paywall');

  await fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
  expect(screen.queryByTestId('paywall')).not.toBeOnTheScreen();
  expect(screen.queryByText(`Note ${FREE_NOTES_PER_DAY + 1}`)).not.toBeOnTheScreen();
});

test('custom habits are premium; after unlocking, one can be added and persists', async () => {
  await render(<HomeScreen />);
  await screen.findByText('Habits');

  await fireEvent.press(screen.getByRole('button', { name: 'Add a custom habit (Premium)' }));
  expect(await screen.findByText('Custom habits are part of Premium.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Unlock Premium for $4.99' }));

  // Unlocking opens the composer the person was reaching for.
  const input = await screen.findByLabelText('New habit name');
  await fireEvent.changeText(input, 'Stretch for 5 minutes');
  await fireEvent.press(screen.getByRole('button', { name: 'Add habit' }));

  const habit = screen.getByRole('checkbox', { name: 'Stretch for 5 minutes' });
  expect(habit).not.toBeChecked();
  await fireEvent.press(habit);
  expect(habit).toBeChecked();

  await waitFor(async () =>
    expect(JSON.parse((await AsyncStorage.getItem(HABITS_KEY)) ?? '[]')).toEqual([
      expect.objectContaining({ label: 'Stretch for 5 minutes', core: false }),
    ]),
  );
});

test('habits, water and expenses update the screen and are saved under today’s date', async () => {
  await render(<HomeScreen />);
  await screen.findByText('Habits');

  const read = screen.getByRole('checkbox', { name: 'Read 20 pages' });
  await fireEvent.press(read);
  expect(read).toBeChecked();
  expect(screen.getByLabelText('1 of 4 habits done')).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: 'Add a glass of water' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Add a glass of water' }));
  expect(screen.getByTestId('water-value')).toHaveTextContent('2 / 8 glasses');

  await fireEvent.changeText(screen.getByLabelText('Amount in dollars'), '4.75');
  await fireEvent.changeText(screen.getByLabelText('What the expense was for (optional)'), 'Coffee');
  await fireEvent.press(screen.getByRole('button', { name: 'Add expense' }));
  await fireEvent.changeText(screen.getByLabelText('Amount in dollars'), '38,20');
  await fireEvent.press(screen.getByRole('button', { name: 'Add expense' }));
  expect(screen.getByTestId('expense-total')).toHaveTextContent('$42.95');

  await fireEvent.changeText(screen.getByLabelText('Amount in dollars'), 'twelve');
  await fireEvent.press(screen.getByRole('button', { name: 'Add expense' }));
  expect(screen.getByText('Enter an amount like 12.50')).toBeOnTheScreen();
  expect(screen.getByTestId('expense-total')).toHaveTextContent('$42.95');

  await waitFor(async () => expect((await storedDay())?.expenses).toHaveLength(2));
  const saved = await storedDay();
  expect(saved.water).toBe(2);
  expect(saved.habitsDone).toEqual(['core-read']);
  expect(saved.expenses.map((e: { cents: number }) => e.cents)).toEqual([3820, 475]);
});

test('saved data comes back on the next launch; yesterday stays out of today', async () => {
  const today = dateKey();
  const d = new Date();
  const yesterday = dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1));
  await AsyncStorage.multiSet([
    [dayStorageKey(today), JSON.stringify({ water: 6, notes: [{ id: 'n1', text: 'From earlier', createdAt: 1 }] })],
    [dayStorageKey(yesterday), JSON.stringify({ water: 3, notes: [{ id: 'n0', text: 'Yesterday', createdAt: 1 }] })],
  ]);

  await render(<HomeScreen />);
  expect(await screen.findByText('From earlier')).toBeOnTheScreen();
  expect(screen.queryByText('Yesterday')).not.toBeOnTheScreen();
  expect(screen.getByTestId('water-value')).toHaveTextContent('6 / 8 glasses');
});

test('loading writes nothing back', async () => {
  await AsyncStorage.setItem(dayStorageKey(dateKey()), JSON.stringify({ water: 2 }));
  const multiSet = AsyncStorage.multiSet as jest.Mock;
  multiSet.mockClear(); // the seeding above went through it
  await render(<HomeScreen />);
  expect(await screen.findByTestId('water-value')).toHaveTextContent('2 / 8 glasses');
  await new Promise((r) => setTimeout(r, 500)); // longer than the save debounce
  expect(multiSet).not.toHaveBeenCalled();
});

test('the daily reminder can be switched on and off', async () => {
  const Notifications = jest.requireMock('expo-notifications');
  await render(<HomeScreen />);
  await screen.findByText('Habits');

  await fireEvent.press(screen.getByRole('button', { name: 'Turn on an 8 PM daily reminder' }));
  expect(await screen.findByRole('button', { name: 'Turn off the 8 PM daily reminder' })).toBeOnTheScreen();
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
    expect.objectContaining({ trigger: expect.objectContaining({ type: 'daily', hour: 20, minute: 0 }) }),
  );

  await fireEvent.press(screen.getByRole('button', { name: 'Turn off the 8 PM daily reminder' }));
  expect(await screen.findByRole('button', { name: 'Turn on an 8 PM daily reminder' })).toBeOnTheScreen();
  expect(Notifications.__scheduled.size).toBe(0);
});
