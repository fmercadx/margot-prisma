import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import { loadDays } from '../src/lib/storage';
import HomeScreen from '../src/screens/HomeScreen';

// These tests render the whole app; the first pays for a cold module load.
jest.setTimeout(30_000);

const N = jest.requireMock('expo-notifications');
const D = '2026-11-18'; // a Wednesday; November has 30 days

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  N.__scheduled.clear();
  jest.useFakeTimers({ now: new Date(2026, 10, 18, 13, 0) });
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

async function openSettings() {
  await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
  return screen.findByTestId('settings');
}

async function closeSettings() {
  await fireEvent.press(screen.getByRole('button', { name: 'Close settings' }));
}

async function addExpense(amount: string) {
  const card = within(screen.getByTestId('card-expenses'));
  await fireEvent.changeText(card.getByLabelText('Amount in dollars'), amount);
  await fireEvent.press(card.getByRole('button', { name: 'Add expense' }));
}

const waterScheduled = () => [...N.__scheduled.keys()].filter((k: string) => k.startsWith('pdh-water-'));

describe('monthly budget', () => {
  test('set it in Settings; Expenses shows the month so far and what each day left can take', async () => {
    await launch();
    expect(screen.queryByTestId('month-budget')).not.toBeOnTheScreen();
    await openSettings();
    await fireEvent.press(screen.getByRole('button', { name: 'Increase monthly budget' }));
    expect(screen.getByTestId('monthly-budget-value')).toHaveTextContent('$100');
    await closeSettings();

    await addExpense('25');
    // $75 left over the 13 days from the 18th to the 30th: $5.76 a day.
    expect(screen.getByTestId('month-budget-text')).toHaveTextContent(
      '$25.00 of $100.00 this month · $5.76 for each of the 13 days left',
    );

    await addExpense('90');
    expect(screen.getByTestId('month-budget-text')).toHaveTextContent('$15.00 over your $100.00 monthly budget');

    // Hide amounts covers it too.
    await fireEvent.press(screen.getByRole('button', { name: 'Hide amounts' }));
    expect(screen.getByTestId('month-budget-text')).not.toHaveTextContent(/15\.00|100\.00/);
  });
});

describe('three good things', () => {
  test('written on the Journal card, saved to the day, back after a restart', async () => {
    const view = await launch();
    const good = within(screen.getByTestId('good-things'));
    await fireEvent.changeText(good.getByLabelText('Good thing 1'), 'Sunny walk');
    await fireEvent(good.getByLabelText('Good thing 1'), 'blur');
    await fireEvent.changeText(good.getByLabelText('Good thing 2'), 'Soup with Ana');
    await fireEvent(good.getByLabelText('Good thing 2'), 'submitEditing');
    await advance(1000);
    expect((await loadDays([D]))[D].gratitude).toEqual(['Sunny walk', 'Soup with Ana']);
    await view.unmount();

    await launch();
    expect(screen.getByLabelText('Good thing 1').props.value).toBe('Sunny walk');
    expect(screen.getByLabelText('Good thing 2').props.value).toBe('Soup with Ana');
  });

  test('a line still being typed is kept when the card goes away (here, stepping to yesterday)', async () => {
    await launch();
    await fireEvent.changeText(screen.getByLabelText('Good thing 1'), 'Unsaved but kept');
    await fireEvent.press(screen.getByRole('button', { name: 'Log the day before' }));
    expect(screen.getByLabelText('Good thing 1').props.value).toBe('');
    await advance(1000);
    expect((await loadDays([D]))[D].gratitude).toEqual(['Unsaved but kept']);
    await fireEvent.press(screen.getByRole('button', { name: 'Back to today' }));
    expect(screen.getByLabelText('Good thing 1').props.value).toBe('Unsaved but kept');
  });
});

describe('water reminders', () => {
  test('switched on in Settings: a week ahead; reaching the goal stops today’s; off cancels them', async () => {
    await launch();
    await openSettings();
    await fireEvent(screen.getByLabelText('Water reminders'), 'valueChange', true);
    await advance(0);
    // At 1 PM: 2, 4 and 6 PM today, then five a day for six more days.
    expect(waterScheduled()).toHaveLength(3 + 5 * 6);
    expect(waterScheduled()).toContain('pdh-water-2026-11-18-14');
    await closeSettings();

    for (let i = 0; i < 8; i++) await fireEvent.press(screen.getByRole('button', { name: 'Add a glass of water' }));
    await advance(0);
    expect(waterScheduled()).toHaveLength(5 * 6);
    expect(waterScheduled()).not.toContain('pdh-water-2026-11-18-14');

    // An undone glass brings today's back.
    await fireEvent.press(screen.getByRole('button', { name: 'Remove a glass of water' }));
    await advance(0);
    expect(waterScheduled()).toContain('pdh-water-2026-11-18-14');

    await openSettings();
    await fireEvent(screen.getByLabelText('Water reminders'), 'valueChange', false);
    await advance(0);
    expect(waterScheduled()).toHaveLength(0);
  });

  test('refused notifications: the switch stays off and the screen says why', async () => {
    await launch();
    N.getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false, status: 'denied' });
    await openSettings();
    await fireEvent(screen.getByLabelText('Water reminders'), 'valueChange', true);
    await advance(0);
    expect(screen.getByText('Notifications are off for Daily Hub. Turn them on in Settings.')).toBeOnTheScreen();
    expect(waterScheduled()).toHaveLength(0);
  });

  test('they are topped up at launch, and Erase everything cancels them', async () => {
    const view = await launch();
    await openSettings();
    await fireEvent(screen.getByLabelText('Water reminders'), 'valueChange', true);
    await advance(1000);
    await view.unmount();

    N.__scheduled.clear();
    await launch();
    await advance(0);
    expect(waterScheduled().length).toBeGreaterThan(0);

    await openSettings();
    await fireEvent.press(screen.getByRole('button', { name: 'Erase all data' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Erase everything' }));
    await advance(1000);
    expect(waterScheduled()).toHaveLength(0);
  });
});
