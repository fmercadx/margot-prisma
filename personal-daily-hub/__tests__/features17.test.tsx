import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Share } from 'react-native';

import { openBackup, readSealedBackup, sealBackup, type SealedBackup } from '../src/lib/backupCrypto';
import { dateKey, lastNDays } from '../src/lib/date';
import { buildExport } from '../src/lib/exportJson';
import { loadDays } from '../src/lib/storage';
import { CORE_HABITS, DEFAULT_SETTINGS, EMPTY_DAY } from '../src/lib/store';
import HomeScreen from '../src/screens/HomeScreen';

// These tests render the whole app (the first pays for a cold module load)
// and some derive real scrypt keys.
jest.setTimeout(30_000);

jest.mock('../src/lib/premium', () => ({
  ...jest.requireActual('../src/lib/premium'),
  PREMIUM_INCLUDED: false, // these test the paywall kept for a later billing release
  purchasePremiumMock: jest.fn(async () => true),
}));

const Sharing = jest.requireMock('expo-sharing');
const Files = jest.requireMock('expo-file-system');
const Picker = jest.requireMock('expo-document-picker');

const PASS = 'correct horse battery';
const today = () => dateKey();
const daysAgo = (n: number) => lastNDays(today(), n + 1)[0];

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  Files.__files.clear();
  Picker.__picker.next = { canceled: true, assets: null };
});

async function launch() {
  await render(<HomeScreen />);
  await screen.findByText('Quick Capture');
}

async function addNote(text: string) {
  await fireEvent.changeText(screen.getByLabelText('New note'), text);
  await fireEvent.press(screen.getByRole('button', { name: 'Save note' }));
}

async function openSettings() {
  await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
  return screen.findByTestId('settings');
}

function pickFile(text: string) {
  const uri = 'file:///cache/DocumentPicker/backup.json';
  Files.__files.set(uri, text);
  Picker.__picker.next = { canceled: false, assets: [{ uri, name: 'backup.json', size: text.length }] };
}

describe('protected export', () => {
  test('exports a file only the passphrase opens', async () => {
    await launch();
    await addNote('Surprise party on Friday');
    await openSettings();
    await fireEvent.press(screen.getByRole('button', { name: 'Export my data' }));

    const protect = () => screen.getByRole('button', { name: 'Export protected' });
    expect(protect()).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Passphrase'), 'short');
    expect(screen.getByTestId('export-hint')).toHaveTextContent('3 more characters');
    await fireEvent.changeText(screen.getByLabelText('Passphrase'), PASS);
    await fireEvent.changeText(screen.getByLabelText('Passphrase again'), `${PASS}!`);
    expect(protect()).toBeDisabled();
    expect(screen.getByTestId('export-hint')).toHaveTextContent(/don’t match/);
    await fireEvent.changeText(screen.getByLabelText('Passphrase again'), PASS);
    expect(protect()).not.toBeDisabled();
    await fireEvent.press(protect());

    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
    const [uri] = Sharing.shareAsync.mock.calls[0];
    expect(uri).toMatch(/-protected\.json$/);
    const text: string = Files.__files.get(uri);
    expect(text).not.toContain('Surprise');
    const opened = await openBackup(readSealedBackup(text) as SealedBackup, PASS);
    expect(opened.ok && JSON.parse(opened.json).days[today()].notes[0].text).toBe('Surprise party on Friday');
  });
});

describe('restoring a protected backup', () => {
  const backup = async () =>
    sealBackup(
      buildExport(
        { [daysAgo(20)]: { ...EMPTY_DAY, notes: [{ id: 'old', text: 'From the protected file', createdAt: 1 }] } },
        [...CORE_HABITS],
        DEFAULT_SETTINGS,
      ).json,
      PASS,
    );

  test('asks for the passphrase; a wrong one is refused, the right one shows the preview', async () => {
    pickFile(await backup());
    await launch();
    await openSettings();
    await fireEvent.press(screen.getByRole('button', { name: 'Restore from a backup' }));
    expect(await screen.findByTestId('restore-unlock')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText('Backup passphrase'), 'not the passphrase');
    await fireEvent.press(screen.getByRole('button', { name: 'Open backup' }));
    expect(await screen.findByText('That passphrase doesn’t open this backup.')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText('Backup passphrase'), PASS);
    await fireEvent.press(screen.getByRole('button', { name: 'Open backup' }));
    expect(await screen.findByTestId('restore-preview')).toHaveTextContent(/It will add 1 new day, 1 note/);
    await fireEvent.press(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(async () => expect((await loadDays([daysAgo(20)]))[daysAgo(20)]?.notes[0].text).toBe('From the protected file'));
  });

  test('a protected file asking for too much work is refused with a plain message', async () => {
    const sealed = JSON.parse(await backup());
    sealed.encryption.N = 2 ** 22;
    pickFile(JSON.stringify(sealed));
    await launch();
    await openSettings();
    await fireEvent.press(screen.getByRole('button', { name: 'Restore from a backup' }));
    expect(await screen.findByText('That protected backup uses settings this app won’t open.')).toBeOnTheScreen();
  });
});

describe('logging an earlier day', () => {
  test('step back to yesterday, log there, and come back to today', async () => {
    await launch();
    expect(screen.getByTestId('logging-day')).toHaveTextContent('Logging today');
    await fireEvent.press(screen.getByRole('button', { name: 'Log the day before' }));
    expect(screen.getByTestId('logging-day')).toHaveTextContent('Logging yesterday');
    expect(screen.getByText('Nothing captured yesterday.')).toBeOnTheScreen();

    await addNote('Forgot to write this down');
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Read 20 pages' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Add a glass of water' }));
    await waitFor(async () => {
      const y = (await loadDays([daysAgo(1)]))[daysAgo(1)];
      expect(y?.notes[0].text).toBe('Forgot to write this down');
      expect(y?.habitsDone).toEqual(['core-read']);
      expect(y?.water).toBe(1);
    });

    await fireEvent.press(screen.getByRole('button', { name: 'Back to today' }));
    expect(screen.getByTestId('logging-day')).toHaveTextContent('Logging today');
    expect(screen.queryByText('Forgot to write this down')).not.toBeOnTheScreen();
    expect(await loadDays([today()])).toEqual({});
  });

  test('goes back a week at most, and forward again to today', async () => {
    await launch();
    for (let i = 0; i < 7; i++) await fireEvent.press(screen.getByRole('button', { name: 'Log the day before' }));
    expect(screen.getByTestId('logging-day')).toHaveTextContent(/Logging last /);
    expect(screen.getByRole('button', { name: 'Log the day before' })).toBeDisabled();
    for (let i = 0; i < 7; i++) await fireEvent.press(screen.getByRole('button', { name: 'Log the day after' }));
    expect(screen.getByTestId('logging-day')).toHaveTextContent('Logging today');
  });
});

describe('sharing a day', () => {
  test('the day sheet hands the day to the share sheet as text', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    await launch();
    await addNote('Picked up the keys');
    await fireEvent.press(screen.getByRole('button', { name: 'Go Premium' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Unlock Premium for $4.99' }));
    await screen.findByText('Premium');
    await fireEvent.press(screen.getByRole('button', { name: 'See everything from today' }));
    await fireEvent.press(within(await screen.findByTestId('day-sheet')).getByRole('button', { name: 'Share this day' }));
    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0][0]).toEqual({ message: expect.stringContaining('• Picked up the keys') });
    share.mockRestore();
  });
});
