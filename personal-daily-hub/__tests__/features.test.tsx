import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { dateKey, lastNDays } from '../src/lib/date';
import { dayStorageKey, loadSettings } from '../src/lib/storage';
import HomeScreen from '../src/screens/HomeScreen';

// These tests render the whole app. On a fresh CI runner Jest has no
// transform cache, so the first test in this file also pays for compiling
// and loading every module the screen imports (2.7-4 s here, past 5 s on
// GitHub's runners). The budget covers that one-off cost; a real hang
// still fails, at 30 s. Unit-test files keep Jest's default 5 s.
jest.setTimeout(30_000);

jest.mock('../src/lib/premium', () => ({
  ...jest.requireActual('../src/lib/premium'),
  purchasePremiumMock: jest.fn(async () => true),
}));

const Auth = jest.requireMock('expo-local-authentication');
const Capture = jest.requireMock('expo-screen-capture');
const Sharing = jest.requireMock('expo-sharing');
const Files = jest.requireMock('expo-file-system');
const Notifications = jest.requireMock('expo-notifications');

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  Auth.__state.level = 3;
  Auth.__state.result = { success: true };
  Files.__files.clear();
  Notifications.__scheduled.clear();
});

async function openSettings() {
  await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
  return screen.findByTestId('settings');
}

/** Send every AppState listener the app registered a state change. */
async function appState(state: 'active' | 'background') {
  const listeners = (AppState.addEventListener as jest.Mock).mock.calls
    .filter(([event]) => event === 'change')
    .map(([, fn]) => fn);
  await act(async () => listeners.forEach((fn) => fn(state)));
}

describe('app lock', () => {
  test('turning it on asks for the owner first, then locks the next launch until unlocked', async () => {
    const first = await render(<HomeScreen />);
    await screen.findByText('Quick Capture');
    await openSettings();

    await fireEvent(screen.getByLabelText('App lock'), 'valueChange', true);
    expect(Auth.authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ promptMessage: 'Confirm to turn on app lock', disableDeviceFallback: false }),
    );
    await waitFor(async () => expect((await loadSettings()).lockEnabled).toBe(true));
    // Not locked out right after turning it on: they just proved who they are.
    expect(screen.queryByTestId('lock-screen')).not.toBeOnTheScreen();
    // Recent-apps preview and screenshots are blocked while the lock is on.
    expect(Capture.preventScreenCaptureAsync).toHaveBeenCalled();
    await first.unmount();

    // Next launch: the prompt fails, so the day is not rendered at all.
    Auth.__state.result = { success: false, error: 'user_cancel' };
    Auth.authenticateAsync.mockClear();
    await render(<HomeScreen />);
    expect(await screen.findByTestId('lock-screen')).toBeOnTheScreen();
    expect(Auth.authenticateAsync).toHaveBeenCalledTimes(1); // asked straight away
    expect(screen.queryByText('Quick Capture')).not.toBeOnTheScreen();

    Auth.__state.result = { success: true };
    await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('Quick Capture')).toBeOnTheScreen();
  });

  test('it locks again after 30 seconds in the background, not after a quick switch', async () => {
    await AsyncStorage.setItem('pdh:v1:settings', JSON.stringify({ lockEnabled: true }));
    await render(<HomeScreen />);
    await screen.findByText('Quick Capture'); // the launch prompt succeeded

    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    await appState('background');
    now.mockReturnValue(1_000_000 + 5_000); // 5 s: e.g. the share sheet
    await appState('active');
    expect(screen.queryByTestId('lock-screen')).not.toBeOnTheScreen();

    await appState('background');
    now.mockReturnValue(1_000_000 + 5_000 + 31_000);
    // The lock screen asks at once; have that prompt dismissed so it stays.
    Auth.__state.result = { success: false, error: 'user_cancel' };
    await appState('active');
    now.mockRestore();
    expect(await screen.findByTestId('lock-screen')).toBeOnTheScreen();
    expect(screen.queryByText('Quick Capture')).not.toBeOnTheScreen();
  });

  test('it cannot be turned on when the phone itself has no screen lock', async () => {
    Auth.__state.level = 0;
    await render(<HomeScreen />);
    await screen.findByText('Quick Capture');
    await openSettings();
    await fireEvent(screen.getByLabelText('App lock'), 'valueChange', true);
    expect(await screen.findByText(/Set a screen lock/)).toBeOnTheScreen();
    expect(Auth.authenticateAsync).not.toHaveBeenCalled();
    expect((await loadSettings()).lockEnabled).toBe(false);
  });

  test('turning it off also needs the owner', async () => {
    await AsyncStorage.setItem('pdh:v1:settings', JSON.stringify({ lockEnabled: true }));
    await render(<HomeScreen />);
    await screen.findByText('Quick Capture');
    await openSettings();

    Auth.__state.result = { success: false, error: 'user_cancel' };
    await fireEvent(screen.getByLabelText('App lock'), 'valueChange', false);
    await new Promise((r) => setTimeout(r, 400));
    expect((await loadSettings()).lockEnabled).toBe(true);

    Auth.__state.result = { success: true };
    await fireEvent(screen.getByLabelText('App lock'), 'valueChange', false);
    await waitFor(async () => expect((await loadSettings()).lockEnabled).toBe(false));
    expect(Capture.allowScreenCaptureAsync).toHaveBeenCalled();
  });
});

describe('settings', () => {
  test('the water goal changes the tracker and is saved', async () => {
    await render(<HomeScreen />);
    await screen.findByText('Quick Capture');
    await openSettings();
    await fireEvent.press(screen.getByRole('button', { name: 'Increase water goal' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Increase water goal' }));
    expect(screen.getByTestId('water-goal-value')).toHaveTextContent('10');
    expect(screen.getByTestId('water-value')).toHaveTextContent('0 / 10 glasses');
    await waitFor(async () => expect((await loadSettings()).waterGoal).toBe(10));
  });

  test('moving the reminder time moves a reminder that is on', async () => {
    await render(<HomeScreen />);
    await screen.findByText('Quick Capture');
    await fireEvent.press(screen.getByRole('button', { name: 'Turn on the 8 PM daily reminder' }));
    await screen.findByRole('button', { name: 'Turn off the 8 PM daily reminder' });

    await openSettings();
    await fireEvent.press(screen.getByRole('button', { name: 'Increase reminder time' }));
    expect(screen.getByTestId('reminder-hour-value')).toHaveTextContent('9 PM');
    await waitFor(() => expect([...Notifications.__scheduled.values()][0].trigger.hour).toBe(21));
    expect(Notifications.__scheduled.size).toBe(1);
  });

  test('says the data is encrypted', async () => {
    await render(<HomeScreen />);
    await screen.findByText('Quick Capture');
    await openSettings();
    expect(screen.getByTestId('privacy-statement')).toHaveTextContent(
      'Stored encrypted on this phone. Nothing is sent anywhere.',
    );
  });
});

describe('undo', () => {
  async function addNote(text: string) {
    await fireEvent.changeText(screen.getByLabelText('New note'), text);
    await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));
  }

  test('a deleted note comes back in its place', async () => {
    const now = jest.spyOn(Date, 'now');
    await render(<HomeScreen />);
    await screen.findByText('Quick Capture');
    now.mockReturnValue(1_000);
    await addNote('First');
    now.mockReturnValue(2_000);
    await addNote('Second');
    now.mockReturnValue(3_000);
    await addNote('Third');
    now.mockRestore();

    await fireEvent.press(screen.getByRole('button', { name: 'Delete note: Second' }));
    expect(screen.queryByText('Second')).not.toBeOnTheScreen();
    expect(screen.getByText('Note deleted')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    const order = screen.getAllByText(/^(First|Second|Third)$/).map((n) => n.props.children);
    expect(order).toEqual(['Third', 'Second', 'First']);
    expect(screen.queryByTestId('undo-toast')).not.toBeOnTheScreen();
  });

  test('a deleted expense comes back and the total with it', async () => {
    await render(<HomeScreen />);
    await screen.findByText('Expenses');
    await fireEvent.changeText(screen.getByLabelText('Amount in dollars'), '12.50');
    await fireEvent.press(screen.getByRole('button', { name: 'Add expense' }));
    expect(screen.getByTestId('expense-total')).toHaveTextContent('$12.50');

    await fireEvent.press(screen.getByRole('button', { name: 'Delete expense $12.50' }));
    expect(screen.getByTestId('expense-total')).toHaveTextContent('$0.00');
    await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByTestId('expense-total')).toHaveTextContent('$12.50');
  });

  test('a removed custom habit comes back, still ticked', async () => {
    await render(<HomeScreen />);
    await screen.findByText('Habits');
    await fireEvent.press(screen.getByRole('button', { name: 'Add a custom habit (Premium)' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Unlock Premium for $4.99' }));
    await fireEvent.changeText(await screen.findByLabelText('New habit name'), 'Stretch');
    await fireEvent.press(screen.getByRole('button', { name: 'Add habit' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Stretch' }));

    await fireEvent.press(screen.getByRole('button', { name: 'Remove habit: Stretch' }));
    expect(screen.queryByRole('checkbox', { name: 'Stretch' })).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('checkbox', { name: 'Stretch' })).toBeChecked();
  });
});

describe('streaks', () => {
  test('a habit done the last three days shows a 3-day streak, before today is ticked', async () => {
    const [d3, d2, d1] = lastNDays(dateKey(), 4); // three days before today
    await AsyncStorage.multiSet(
      [d3, d2, d1].map((d) => [dayStorageKey(d), JSON.stringify({ habitsDone: ['core-read'] })]),
    );
    await render(<HomeScreen />);
    expect(await screen.findByLabelText('3-day streak')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Read 20 pages' }));
    expect(screen.getByLabelText('4-day streak')).toBeOnTheScreen();
  });
});

describe('export', () => {
  test('shares a JSON file of everything, without the lock setting, and tidies old files', async () => {
    const old = new Files.File(Files.Paths.cache, 'personal-daily-hub-2020-01-01.json');
    old.create();
    const longAgo = '2026-01-15'; // older than the 60 days kept in memory
    await AsyncStorage.multiSet([
      [dayStorageKey(longAgo), JSON.stringify({ water: 3 })],
      ['pdh:v1:settings', JSON.stringify({ waterGoal: 9 })],
    ]);

    await render(<HomeScreen />);
    await screen.findByText('Quick Capture');
    expect(Files.__files.has(old.uri)).toBe(false); // removed at launch

    await fireEvent.changeText(screen.getByLabelText('New note'), 'In the export');
    await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));
    await openSettings();
    await fireEvent.press(screen.getByRole('button', { name: 'Export my data' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Export without a passphrase' }));

    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
    const [uri, options] = Sharing.shareAsync.mock.calls[0];
    expect(options).toMatchObject({ mimeType: 'application/json' });
    const file = JSON.parse(Files.__files.get(uri));
    expect(file).toMatchObject({ app: 'Personal Daily Hub', format: 1, settings: { waterGoal: 9, reminderHour: 20 } });
    expect(file.settings).not.toHaveProperty('lockEnabled');
    expect(Object.keys(file.days)).toEqual([longAgo, dateKey()]);
    expect(file.days[dateKey()].notes[0].text).toBe('In the export');
    expect(file.habits).toHaveLength(4);
  });
});
