import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { dateKey, lastNDays } from '../src/lib/date';
import { buildExport } from '../src/lib/exportJson';
import { dayStorageKey, loadDays, loadHabits } from '../src/lib/storage';
import { CORE_HABITS, DEFAULT_SETTINGS, EMPTY_DAY } from '../src/lib/store';
import HomeScreen from '../src/screens/HomeScreen';

// These tests render the whole app; the first in the file also pays for a
// cold module load (see HomeScreen.test.tsx).
jest.setTimeout(30_000);

jest.mock('../src/lib/premium', () => ({
  ...jest.requireActual('../src/lib/premium'),
  purchasePremiumMock: jest.fn(async () => true),
}));

const Haptics = jest.requireMock('expo-haptics');
const Picker = jest.requireMock('expo-document-picker');
const Files = jest.requireMock('expo-file-system');

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  Files.__files.clear();
  Picker.__picker.next = { canceled: true, assets: null };
});

const today = () => dateKey();
const daysAgo = (n: number) => lastNDays(today(), n + 1)[0];

async function launch() {
  await render(<HomeScreen />);
  await screen.findByText('Quick Capture');
}

async function goPremium() {
  await fireEvent.press(screen.getByRole('button', { name: 'Go Premium' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Unlock Premium for $4.99' }));
  await screen.findByText('Premium');
}

/** Make the next pick return `text` as a cached file, as the real picker does. */
function pickFile(text: string) {
  const uri = 'file:///cache/DocumentPicker/backup.json';
  Files.__files.set(uri, text);
  Picker.__picker.next = { canceled: false, assets: [{ uri, name: 'backup.json', size: text.length }] };
  return uri;
}

describe('mood', () => {
  test('a face sets the mood, tapping it again clears it, and it is saved', async () => {
    await launch();
    expect(screen.getByTestId('mood-value')).toHaveTextContent('Not logged');

    await fireEvent.press(screen.getByRole('radio', { name: 'Mood: Good' }));
    expect(screen.getByTestId('mood-value')).toHaveTextContent('Good');
    expect(screen.getByRole('radio', { name: 'Mood: Good' })).toBeChecked();
    await waitFor(async () => expect((await loadDays([today()]))[today()]?.mood).toBe(4));

    await fireEvent.press(screen.getByRole('radio', { name: 'Mood: Good' }));
    expect(screen.getByTestId('mood-value')).toHaveTextContent('Not logged');
  });
});

describe('editing notes', () => {
  test('tap a note, change it, save: the new text shows as edited and is stored', async () => {
    await launch();
    await fireEvent.changeText(screen.getByLabelText('New note'), 'Call dentist');
    await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));

    await fireEvent.press(screen.getByRole('button', { name: 'Edit note: Call dentist' }));
    await fireEvent.changeText(screen.getByLabelText('Edit note'), 'Call the dentist at 3');
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));

    expect(screen.getByText('Call the dentist at 3')).toBeOnTheScreen();
    expect(screen.queryByText('Call dentist')).not.toBeOnTheScreen();
    expect(screen.getByText(/· edited/)).toBeOnTheScreen();
    await waitFor(async () =>
      expect((await loadDays([today()]))[today()]?.notes[0]).toMatchObject({ text: 'Call the dentist at 3' }),
    );
  });

  test('cancel leaves the note as it was, and a blank edit cannot be saved', async () => {
    await launch();
    await fireEvent.changeText(screen.getByLabelText('New note'), 'Keep me');
    await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));

    await fireEvent.press(screen.getByRole('button', { name: 'Edit note: Keep me' }));
    await fireEvent.changeText(screen.getByLabelText('Edit note'), '   ');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel editing' }));
    expect(screen.getByText('Keep me')).toBeOnTheScreen();
  });
});

describe('haptics', () => {
  test('ticking a habit taps; switching haptics off in Settings stops it', async () => {
    await launch();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Read 20 pages' }));
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
    await fireEvent(await screen.findByLabelText('Haptic feedback'), 'valueChange', false);
    await fireEvent.press(screen.getAllByRole('button', { name: 'Close settings' }).at(-1)!);

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Read 20 pages' }));
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });
});

describe('history (Premium)', () => {
  beforeEach(async () => {
    await AsyncStorage.multiSet([
      [dayStorageKey(daysAgo(1)), JSON.stringify({ water: 6, energy: 7, mood: 5, habitsDone: ['core-read'],
        notes: [{ id: 'y1', text: 'Yesterday’s note', createdAt: 1 }],
        expenses: [{ id: 'ye', cents: 1000, label: 'Lunch', createdAt: 1 }] })],
      [dayStorageKey(daysAgo(2)), JSON.stringify({ water: 4, energy: 5 })],
    ]);
  });

  test('the weekly summary shows averages and totals for the last 7 days', async () => {
    await launch();
    await goPremium();
    const summary = screen.getByTestId('week-summary');
    expect(summary).toBeOnTheScreen();
    expect(screen.getByLabelText('Water a day: 5.0')).toBeOnTheScreen();
    expect(screen.getByLabelText('Energy: 6.0')).toBeOnTheScreen();
    expect(screen.getByLabelText('Spent: $10.00')).toBeOnTheScreen();
    expect(screen.getByLabelText('Habits done: 4%')).toBeOnTheScreen(); // 1 of 7 days × 4 habits
  });

  test('a day opens with everything logged, and the arrows step through days', async () => {
    await launch();
    await goPremium();
    await fireEvent.press(screen.getByRole('button', { name: 'See everything from today' }));
    expect(await screen.findByTestId('day-sheet')).toBeOnTheScreen();
    expect(screen.getByTestId('day-sheet-title')).toHaveTextContent('Today');
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled();

    await fireEvent.press(screen.getByRole('button', { name: 'Previous day' }));
    expect(screen.getByTestId('day-sheet-title')).not.toHaveTextContent('Today');
    // The habit list and mood faces are also on the home screen behind the
    // sheet, so look inside the sheet only.
    const sheet = within(screen.getByTestId('day-sheet'));
    expect(sheet.getByText('Yesterday’s note')).toBeOnTheScreen();
    expect(sheet.getByText('Lunch')).toBeOnTheScreen();
    expect(sheet.getByText('Read 20 pages')).toBeOnTheScreen();
    expect(sheet.getByLabelText('Mood: Great')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Previous day' }));
    expect(within(screen.getByTestId('day-sheet')).getByLabelText('Water: 4/8')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Close day' }));
    expect(screen.queryByTestId('day-sheet')).not.toBeOnTheScreen();
  });
});

describe('restore from a backup', () => {
  const backupText = () =>
    buildExport(
      {
        [daysAgo(10)]: { ...EMPTY_DAY, water: 3, notes: [{ id: 'old', text: 'From the old phone', createdAt: 1 }] },
        [daysAgo(200)]: { ...EMPTY_DAY, energy: 4 }, // older than the 60 days kept in memory
      },
      [...CORE_HABITS, { id: 'h-old', label: 'Journal', core: false }],
      DEFAULT_SETTINGS,
    ).json;

  async function openRestore() {
    await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByTestId('settings');
    await fireEvent.press(screen.getByRole('button', { name: 'Restore from a backup' }));
  }

  test('shows what will be added, then adds it, encrypted, without touching today', async () => {
    await launch();
    await fireEvent.changeText(screen.getByLabelText('New note'), 'Already here');
    await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));

    const uri = pickFile(backupText());
    await openRestore();
    const preview = await screen.findByTestId('restore-preview');
    expect(preview).toHaveTextContent(/It will add 2 new days, 1 note, 1 custom habit\./);
    expect(preview).toHaveTextContent(/Nothing on this phone is replaced/);
    expect(Files.__files.has(uri)).toBe(false); // the picker's plain copy is deleted after reading

    await fireEvent.press(screen.getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText('Restored 2 days from your backup.')).toBeOnTheScreen();
    expect(screen.getByText('Already here')).toBeOnTheScreen();
    expect(screen.getByRole('checkbox', { name: 'Journal' })).toBeOnTheScreen();

    await waitFor(async () => {
      const days = await loadDays([daysAgo(10), daysAgo(200)]);
      expect(days[daysAgo(10)]?.notes[0].text).toBe('From the old phone');
      expect(days[daysAgo(200)]?.energy).toBe(4);
    });
    expect((await loadHabits()).map((h) => h.label)).toContain('Journal');
    const raw = await AsyncStorage.getItem(dayStorageKey(daysAgo(10)));
    expect(raw).not.toContain('From the old phone'); // stored sealed like everything else
  });

  test('cancel at the preview writes nothing', async () => {
    await launch();
    pickFile(backupText());
    await openRestore();
    await screen.findByTestId('restore-preview');
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel restore' }));
    expect(screen.queryByTestId('restore-preview')).not.toBeOnTheScreen();
    await new Promise((r) => setTimeout(r, 400));
    expect(await loadDays([daysAgo(10)])).toEqual({});
  });

  test('a file that is not a backup is refused with a plain explanation', async () => {
    await launch();
    pickFile('{"hello": "world"}');
    await openRestore();
    expect(await screen.findByText('That file is not a Daily Hub backup.')).toBeOnTheScreen();
    expect(screen.queryByTestId('restore-preview')).not.toBeOnTheScreen();
  });

  test('restoring a backup that adds nothing says so', async () => {
    await launch();
    pickFile(JSON.stringify({ app: 'Personal Daily Hub', format: 1, days: {}, habits: [] }));
    await openRestore();
    expect(await screen.findByText('Everything in that backup is already on this phone.')).toBeOnTheScreen();
  });
});
