import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { SETTINGS_KEY } from '../src/lib/storage';
import HomeScreen from '../src/screens/HomeScreen';

// The app as it ships: everything included, no purchases (PREMIUM_INCLUDED).
// jest.setup.js turns it off for the other suites, which test the paywall
// kept for a later release with real billing.
jest.mock('../src/lib/premium', () => ({ ...jest.requireActual('../src/lib/premium'), PREMIUM_INCLUDED: true }));

jest.setTimeout(30_000);

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.useFakeTimers({ now: new Date(2026, 10, 26, 9, 0) });
});
afterEach(() => jest.useRealTimers());

async function launch() {
  await render(<HomeScreen />);
  await screen.findByText('Quick Capture');
}

async function addNote(text: string) {
  await fireEvent.changeText(screen.getByLabelText('New note'), text);
  await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));
}

describe('everything included', () => {
  test('no Premium badge, no price, and no limit on notes', async () => {
    await launch();
    expect(screen.queryByTestId('premium-badge')).not.toBeOnTheScreen();
    expect(screen.queryByText(/\$4\.99/)).not.toBeOnTheScreen();
    expect(screen.queryByText(/free$/)).not.toBeOnTheScreen(); // no "1/3 free" counter
    for (const t of ['One', 'Two', 'Three', 'Four', 'Five']) await addNote(t);
    expect(screen.queryByTestId('paywall')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Edit note: Five' })).toBeOnTheScreen();
  });

  test('custom habits, Insights and History are open to everyone', async () => {
    await launch();
    await fireEvent.press(screen.getByRole('button', { name: 'Add a custom habit' }));
    expect(screen.queryByTestId('paywall')).not.toBeOnTheScreen();
    expect(screen.getByLabelText('New habit name')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Unlock history with Premium' })).not.toBeOnTheScreen();
    expect(within(screen.getByTestId('card-history')).getByTestId('month-calendar')).toBeOnTheScreen();
  });

  test('a test unlock saved by an earlier build leaves no Premium section behind', async () => {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ mockPremium: true }));
    await launch();
    await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByTestId('settings');
    expect(screen.queryByTestId('premium-off')).not.toBeOnTheScreen();
    expect(screen.queryByText('Premium is on')).not.toBeOnTheScreen();
  });
});
