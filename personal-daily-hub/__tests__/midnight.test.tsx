import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { dayStorageKey } from '../src/lib/storage';
import HomeScreen from '../src/screens/HomeScreen';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.useFakeTimers({ now: new Date(2026, 10, 8, 23, 59, 0) });
});
afterEach(() => jest.useRealTimers());

test('left open past midnight, the screen rolls to a fresh day and yesterday is kept', async () => {
  await render(<HomeScreen />);
  await screen.findByText('Sunday');

  await fireEvent.changeText(screen.getByLabelText('New note'), 'Late-night idea');
  await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Add a glass of water' }));
  expect(screen.getByText('Late-night idea')).toBeOnTheScreen();

  // Two minutes later it is Monday.
  await act(async () => {
    await jest.advanceTimersByTimeAsync(2 * 60_000);
  });

  expect(screen.getByText('Monday')).toBeOnTheScreen();
  expect(screen.queryByText('Late-night idea')).not.toBeOnTheScreen();
  expect(screen.getByTestId('water-value')).toHaveTextContent('0 / 8 glasses');

  const sunday = JSON.parse((await AsyncStorage.getItem(dayStorageKey('2026-11-08')))!);
  expect(sunday.notes.map((n: { text: string }) => n.text)).toEqual(['Late-night idea']);
  expect(sunday.water).toBe(1);
  expect(await AsyncStorage.getItem(dayStorageKey('2026-11-09'))).toBeNull();
});
