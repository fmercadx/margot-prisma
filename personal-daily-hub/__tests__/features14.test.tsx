import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { dateKey, lastNDays, monthTitle, parseDateKey, weekdayName } from '../src/lib/date';
import { dayStorageKey, loadDays, loadSettings } from '../src/lib/storage';
import HomeScreen from '../src/screens/HomeScreen';

// These tests render the whole app; the first in the file also pays for a
// cold module load (see HomeScreen.test.tsx).
jest.setTimeout(30_000);

jest.mock('../src/lib/premium', () => ({
  ...jest.requireActual('../src/lib/premium'),
  PREMIUM_INCLUDED: false, // these test the paywall kept for a later billing release
  purchasePremiumMock: jest.fn(async () => true),
}));

const Auth = jest.requireMock('expo-local-authentication');
const Haptics = jest.requireMock('expo-haptics');

const today = () => dateKey();
const daysAgo = (n: number) => lastNDays(today(), n + 1)[0];

beforeEach(async () => {
  await AsyncStorage.clear();
  Auth.__state.level = 3;
  Auth.__state.result = { success: true };
  jest.clearAllMocks();
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

async function appState(state: 'active' | 'background') {
  const listeners = (AppState.addEventListener as jest.Mock).mock.calls
    .filter(([event]) => event === 'change')
    .map(([, fn]) => fn);
  await act(async () => listeners.forEach((fn) => fn(state)));
}

const seed = (pairs: [string, object][]) =>
  AsyncStorage.multiSet(pairs.map(([date, v]) => [dayStorageKey(date), JSON.stringify(v)]));

describe('to-dos', () => {
  test('capture a to-do, tick it off and back; it is saved as a to-do', async () => {
    await launch();
    await fireEvent.press(screen.getByRole('switch', { name: 'Add as a to-do' }));
    expect(screen.getByRole('switch', { name: 'Add as a to-do' })).toBeChecked();
    await fireEvent.changeText(screen.getByLabelText('New note'), 'Buy milk');
    await fireEvent.press(screen.getByRole('button', { name: 'Save to-do' }));

    const check = screen.getByRole('checkbox', { name: 'Done: Buy milk' });
    expect(check).not.toBeChecked();
    await fireEvent.press(check);
    expect(screen.getByRole('checkbox', { name: 'Done: Buy milk' })).toBeChecked();
    await waitFor(async () => expect((await loadDays([today()]))[today()]?.notes[0]).toMatchObject({ text: 'Buy milk', task: true, doneAt: expect.any(Number) }));

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Done: Buy milk' }));
    expect(screen.getByRole('checkbox', { name: 'Done: Buy milk' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Delete to-do: Buy milk' })).toBeOnTheScreen();
  });

  test('unfinished ones from earlier days can be brought over, once', async () => {
    await seed([
      [daysAgo(1), { notes: [
        { id: 'a', text: 'Call the bank', createdAt: 3, task: true },
        { id: 'b', text: 'Pay rent', createdAt: 2, task: true, doneAt: 9 },
        { id: 'c', text: 'Just a note', createdAt: 1 },
      ] }],
      [daysAgo(3), { notes: [{ id: 'd', text: 'Book flights', createdAt: 1, task: true }] }],
    ]);
    await launch();
    const banner = screen.getByTestId('carry-banner');
    expect(banner).toHaveTextContent(/2 unfinished to-dos from the last few days/);

    await fireEvent.press(screen.getByRole('button', { name: 'Bring them over to today' }));
    expect(await screen.findByText('Brought 2 to-dos over to today.')).toBeOnTheScreen();
    expect(screen.queryByTestId('carry-banner')).not.toBeOnTheScreen();
    expect(screen.getByRole('checkbox', { name: 'Done: Call the bank' })).toBeOnTheScreen();
    expect(screen.getByText(new RegExp(`from ${weekdayName(parseDateKey(daysAgo(3)))}`))).toBeOnTheScreen();

    await waitFor(async () => {
      const days = await loadDays([today(), daysAgo(1), daysAgo(3)]);
      expect(days[today()]?.notes.map((n) => [n.text, n.carriedFrom])).toEqual([
        ['Call the bank', daysAgo(1)],
        ['Book flights', daysAgo(3)],
      ]);
      expect(days[daysAgo(1)]?.notes[0].carriedTo).toBe(today());
      expect(days[daysAgo(3)]?.notes[0].carriedTo).toBe(today());
    });
  });

  test('from yesterday only, the banner says so; "Not now" hides it', async () => {
    await seed([[daysAgo(1), { notes: [{ id: 'a', text: 'Call the bank', createdAt: 3, task: true }] }]]);
    await launch();
    expect(screen.getByTestId('carry-banner')).toHaveTextContent(/1 unfinished to-do from yesterday/);
    await fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByTestId('carry-banner')).not.toBeOnTheScreen();
  });

  test('bringing over more than the free three opens the paywall, then finishes', async () => {
    await seed([
      [daysAgo(1), { notes: ['One', 'Two', 'Three', 'Four'].map((text, i) => ({ id: `t${i}`, text, createdAt: i + 1, task: true })) }],
    ]);
    await launch();
    await fireEvent.press(screen.getByRole('button', { name: 'Bring them over to today' }));
    expect(await screen.findByRole('button', { name: 'Unlock Premium for $4.99' })).toBeOnTheScreen();
    expect(screen.queryByRole('checkbox', { name: 'Done: Four' })).not.toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Unlock Premium for $4.99' }));
    expect(await screen.findByText('Brought 4 to-dos over to today.')).toBeOnTheScreen();
    expect(screen.getByRole('checkbox', { name: 'Done: Four' })).toBeOnTheScreen();
  });
});

describe('sleep', () => {
  test('log it in half hours, clear it; it is saved for today', async () => {
    await launch();
    expect(screen.getByTestId('sleep-value')).toHaveTextContent('Not logged');
    expect(screen.getByRole('button', { name: 'Half an hour less sleep' })).toBeDisabled();

    await fireEvent.press(screen.getByRole('button', { name: 'Log sleep' }));
    expect(screen.getByTestId('sleep-value')).toHaveTextContent('7 h');
    await fireEvent.press(screen.getByRole('button', { name: 'Half an hour more sleep' }));
    expect(screen.getByTestId('sleep-value')).toHaveTextContent('7½ h');
    await waitFor(async () => expect((await loadDays([today()]))[today()]?.sleep).toBe(7.5));

    await fireEvent.press(screen.getByRole('button', { name: 'Clear sleep' }));
    expect(screen.getByTestId('sleep-value')).toHaveTextContent('Not logged');
  });
});

describe('streak milestones', () => {
  test('ticking the third day in a row says so, with a stronger tap', async () => {
    await seed([
      [daysAgo(1), { habitsDone: ['core-read'] }],
      [daysAgo(2), { habitsDone: ['core-read'] }],
    ]);
    await launch();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Read 20 pages' }));
    expect(await screen.findByText('3-day streak on “Read 20 pages”. Keep it going!')).toBeOnTheScreen();
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);

    // Not a milestone: an ordinary tick.
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Move for 30 minutes' }));
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });
});

describe('month summary (Premium)', () => {
  test('sums the month so far under the calendar', async () => {
    await seed([
      [today(), {
        habitsDone: ['core-read', 'core-move'],
        sleep: 7.5,
        expenses: [
          { id: 'e1', cents: 1200, label: '', category: 'food', createdAt: 1 },
          { id: 'e2', cents: 3000, label: 'Phone', category: 'bills', createdAt: 2 },
        ],
      }],
    ]);
    await launch();
    await goPremium();
    const month = monthTitle(parseDateKey(today())).split(' ')[0];
    const counted = parseDateKey(today()).getDate(); // the 1st to today, all in memory
    const rate = Math.round((2 / (counted * 4)) * 100);
    const summary = screen.getByTestId('month-summary');
    expect(within(summary).getByLabelText(`${month}, Habits done: ${rate}%`)).toBeOnTheScreen();
    expect(within(summary).getByLabelText(`${month}, Spent: $42.00`)).toBeOnTheScreen();
    expect(within(summary).getByLabelText(`${month}, Sleep a night: 7.5 h`)).toBeOnTheScreen();
    const cats = screen.getByTestId('month-categories');
    expect(cats).toHaveTextContent(new RegExp(`Where it went in ${month}`));
    expect(within(cats).getByLabelText('Bills: $30.00, 71%')).toBeOnTheScreen();
  });
});

describe('relock timing', () => {
  test('shown with app lock on; "At once" locks after even a moment away', async () => {
    await AsyncStorage.setItem('pdh:v1:settings', JSON.stringify({ lockEnabled: true }));
    await launch();
    await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByTestId('settings');
    expect(screen.getByTestId('relock-value')).toHaveTextContent('30 s');
    await fireEvent.press(screen.getByRole('button', { name: 'Decrease time before locking again' }));
    expect(screen.getByTestId('relock-value')).toHaveTextContent('At once');
    await waitFor(async () => expect((await loadSettings()).relockAfterSec).toBe(0));
    await fireEvent.press(screen.getAllByRole('button', { name: 'Close settings' }).at(-1)!);

    Auth.__state.result = { success: false, error: 'user_cancel' };
    await appState('background');
    await appState('active');
    expect(await screen.findByTestId('lock-screen')).toBeOnTheScreen();
  });

  test('hidden while app lock is off', async () => {
    await launch();
    await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByTestId('settings');
    expect(screen.queryByText('Lock again after')).not.toBeOnTheScreen();
  });
});
