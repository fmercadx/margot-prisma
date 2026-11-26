import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import { isSealed } from '../src/lib/codec';
import { dayStorageKey, GOALS_KEY, loadSettings, SETTINGS_KEY } from '../src/lib/storage';
import { EMPTY_DAY, type DayLog } from '../src/lib/store';
import HomeScreen from '../src/screens/HomeScreen';

// These tests render the whole app; the first pays for a cold module load.
jest.setTimeout(30_000);

const N = jest.requireMock('expo-notifications');

beforeEach(async () => {
  await AsyncStorage.clear();
  N.__scheduled.clear();
  jest.clearAllMocks();
  jest.useFakeTimers({ now: new Date(2026, 10, 16, 9, 0) }); // Monday; last week ran Sunday Nov 8 to Saturday Nov 14
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
const closeSettings = () => fireEvent.press(screen.getByRole('button', { name: 'Close settings' }));

/** Saved as an older build would have: plain JSON, sealed at the next launch. */
async function seed(key: string, value: unknown) {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}
const seedDay = (date: string, day: Partial<DayLog>) => seed(dayStorageKey(date), { ...EMPTY_DAY, ...day });
const food = (id: string, cents: number) => ({ id, cents, label: '', category: 'food' as const, createdAt: 1 });

describe('week in review', () => {
  async function seedLastWeek() {
    for (const d of ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']) {
      await seedDay(d, { habitsDone: ['core-read'], mood: 4, sleep: 7.5 });
    }
    await seedDay('2026-11-13', { expenses: [food('e1', 1850)] });
    await seed(GOALS_KEY, [
      { id: 'g1', text: 'Book the dentist', week: '2026-11-08', createdAt: 1, doneAt: 2 },
      { id: 'g2', text: 'Clear the inbox', week: '2026-11-08', createdAt: 2 },
    ]);
  }

  test('last week sits at the top of this week’s card until it is put away', async () => {
    await seedLastWeek();
    const view = await launch();
    const review = within(screen.getByTestId('week-review'));
    expect(review.getByText('Last week · Nov 8 – 14')).toBeOnTheScreen();
    for (const label of [
      'Last week, goals: 1 of 2',
      'Last week, mood: Good',
      'Last week, sleep: 7.5 h',
      'Last week, spent: $18.50',
    ]) {
      expect(review.getByLabelText(label)).toBeOnTheScreen();
    }
    expect(review.getByTestId('week-review-steadiest')).toHaveTextContent(
      'Steadiest habit: Read 20 pages, 4 of 7 days',
    );
    // No focus sessions last week, so no focus figure.
    expect(review.queryByLabelText(/^Last week, focus/)).not.toBeOnTheScreen();

    await fireEvent.press(review.getByRole('button', { name: 'Put last week’s review away' }));
    expect(screen.queryByTestId('week-review')).not.toBeOnTheScreen();
    await advance(1000);
    expect((await loadSettings()).reviewedWeek).toBe('2026-11-08');
    expect(isSealed((await AsyncStorage.getItem(SETTINGS_KEY))!)).toBe(true);
    await view.unmount();

    await launch();
    expect(screen.queryByTestId('week-review')).not.toBeOnTheScreen();
  });

  test('the next week brings the next review', async () => {
    await seed(SETTINGS_KEY, { reviewedWeek: '2026-11-08' });
    await seedDay('2026-11-18', { mood: 5 });
    jest.setSystemTime(new Date(2026, 10, 23, 9, 0));
    await launch();
    expect(within(screen.getByTestId('week-review')).getByText('Last week · Nov 15 – 21')).toBeOnTheScreen();
  });

  test('nothing logged last week: no review', async () => {
    await seedDay('2026-11-16', { water: 2 }); // today
    await launch();
    expect(screen.queryByTestId('week-review')).not.toBeOnTheScreen();
  });

  test('hide amounts covers the review too', async () => {
    await seedLastWeek();
    await launch();
    await fireEvent.press(screen.getByRole('button', { name: 'Hide amounts' }));
    expect(within(screen.getByTestId('week-review')).getByLabelText('Last week, spent: $•••')).toBeOnTheScreen();
  });
});

describe('budgets by category', () => {
  async function addFood(dollars: string) {
    const card = within(screen.getByTestId('card-expenses'));
    await fireEvent.changeText(card.getByLabelText('Amount in dollars'), dollars);
    await fireEvent.press(card.getByRole('radio', { name: 'Category: Food' }));
    await fireEvent.press(card.getByRole('button', { name: 'Add expense' }));
  }

  test('set in Settings; the card tracks the month; crossing 80% and the limit says so', async () => {
    await seedDay('2026-11-02', { expenses: [food('old', 1000)] });
    await seedDay('2026-10-30', { expenses: [food('october', 9900)] }); // last month: not counted
    await launch();
    expect(screen.queryByTestId('category-budgets')).not.toBeOnTheScreen();

    await openSettings();
    for (let i = 0; i < 2; i++) await fireEvent.press(screen.getByRole('button', { name: 'Increase Food budget' }));
    expect(screen.getByTestId('category-budget-food-value')).toHaveTextContent('$50');
    await closeSettings();

    const row = () => screen.getByTestId('category-budget-food');
    expect(row().props.accessibilityLabel).toBe('Food: $10.00 of $50.00 this month');
    await addFood('25');
    expect(screen.queryByText(/monthly budget/)).not.toBeOnTheScreen(); // 70%: nothing to say yet
    await addFood('6');
    expect(screen.getByText('Food has used 82% of its monthly budget.')).toBeOnTheScreen();
    expect(row().props.accessibilityLabel).toBe('Food: $41.00 of $50.00 this month, close to the limit');
    await addFood('12');
    expect(screen.getByText('Food is over its monthly budget.')).toBeOnTheScreen();
    expect(row().props.accessibilityLabel).toBe('Food: $3.00 over $50.00 this month');

    await advance(1000);
    expect((await loadSettings()).categoryBudgets).toEqual({ food: 5000 });
  });

  test('hide amounts covers them, and the message never names an amount', async () => {
    await seed(SETTINGS_KEY, { categoryBudgets: { food: 2500 }, hideAmounts: true });
    await launch();
    expect(screen.getByTestId('category-budget-food').props.accessibilityLabel).toBe('Food: $••• of $••• this month');
    await addFood('30');
    expect(screen.getByText('Food is over its monthly budget.')).toBeOnTheScreen();
  });

  test('turned down to off, the row goes', async () => {
    await seed(SETTINGS_KEY, { categoryBudgets: { food: 2500 } });
    await launch();
    expect(screen.getByTestId('category-budget-food')).toBeOnTheScreen();
    await openSettings();
    await fireEvent.press(screen.getByRole('button', { name: 'Decrease Food budget' }));
    expect(screen.getByTestId('category-budget-food-value')).toHaveTextContent('Off');
    await closeSettings();
    expect(screen.queryByTestId('category-budgets')).not.toBeOnTheScreen();
  });
});

describe('wind-down reminder', () => {
  const windDown = () => N.__scheduled.get('pdh-wind-down');

  test('switch it on at 10 PM, move it, switch it off', async () => {
    await launch();
    await openSettings();
    expect(screen.queryByLabelText('Decrease wind-down time')).not.toBeOnTheScreen();
    await fireEvent(screen.getByTestId('wind-down-switch'), 'valueChange', true);
    await advance(10);
    expect(windDown()?.trigger).toMatchObject({ type: 'daily', hour: 22, minute: 0 });
    expect(windDown()?.content.title).toBe('Time to wind down');
    expect(screen.getByTestId('wind-down-time-value')).toHaveTextContent('10:00 PM');

    await fireEvent.press(screen.getByRole('button', { name: 'Increase wind-down time' }));
    expect(screen.getByTestId('wind-down-time-value')).toHaveTextContent('10:30 PM');
    await advance(10);
    expect(windDown()?.trigger).toMatchObject({ hour: 22, minute: 30 });
    await advance(1000);
    expect((await loadSettings()).windDownAt).toBe(1350);

    await fireEvent(screen.getByTestId('wind-down-switch'), 'valueChange', false);
    await advance(10);
    expect(windDown()).toBeUndefined();
    expect(screen.queryByTestId('wind-down-time-value')).not.toBeOnTheScreen();
  });

  test('set again at launch, so it survives the OS dropping it', async () => {
    await seed(SETTINGS_KEY, { windDownAt: 1290 });
    await launch();
    await advance(10);
    expect(windDown()?.trigger).toMatchObject({ type: 'daily', hour: 21, minute: 30 });
  });

  test('notifications refused: it stays off and says why', async () => {
    await launch();
    await openSettings();
    N.getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false, status: 'denied' });
    await fireEvent(screen.getByTestId('wind-down-switch'), 'valueChange', true);
    await advance(10);
    expect(windDown()).toBeUndefined();
    expect(screen.getByText('Notifications are off for Daily Hub. Turn them on in Settings.')).toBeOnTheScreen();
    expect((await loadSettings()).windDownAt).toBeNull();
  });

  test('erase everything cancels it', async () => {
    await seed(SETTINGS_KEY, { windDownAt: 1320 });
    await launch();
    await advance(10);
    expect(windDown()).toBeDefined();
    await openSettings();
    await fireEvent.press(screen.getByRole('button', { name: 'Erase all data' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Erase everything' }));
    await screen.findByText('Everything on this phone has been erased.');
    await advance(10);
    expect(windDown()).toBeUndefined();
  });
});
