import {
  clockTime,
  dateKey,
  isDateKey,
  lastNDays,
  longDate,
  msUntilMidnight,
  msUntilNextMinute,
  weekdayName,
} from '../src/lib/date';
import { formatCents, formatCentsCompact, parseAmountToCents } from '../src/lib/money';
import { canAddNote, FREE_NOTES_PER_DAY, purchasePremiumMock } from '../src/lib/premium';

describe('dates are local, never UTC', () => {
  test('a late-evening moment keeps its own local date', () => {
    // 11:30 PM on Jan 5. toISOString() would say Jan 6 anywhere west of UTC.
    expect(dateKey(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
    expect(dateKey(new Date(2026, 0, 6, 0, 0, 1))).toBe('2026-01-06');
  });

  test('lastNDays steps by calendar day across month and year ends', () => {
    expect(lastNDays('2026-03-02', 4)).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
    expect(lastNDays('2027-01-01', 2)).toEqual(['2026-12-31', '2027-01-01']);
    expect(lastNDays('2028-03-01', 2)).toEqual(['2028-02-29', '2028-03-01']); // leap year
  });

  test('isDateKey rejects impossible and malformed dates', () => {
    expect(isDateKey('2026-11-08')).toBe(true);
    expect(isDateKey('2026-02-31')).toBe(false);
    expect(isDateKey('2026-1-8')).toBe(false);
    expect(isDateKey('../secrets')).toBe(false);
    expect(isDateKey(20261108)).toBe(false);
  });

  test('header strings', () => {
    const d = new Date(2026, 10, 8, 20, 5);
    expect(weekdayName(d)).toBe('Sunday');
    expect(longDate(d)).toBe('November 8, 2026');
    expect(clockTime(d)).toBe('8:05 PM');
    expect(clockTime(new Date(2026, 0, 1, 0, 7))).toBe('12:07 AM');
    expect(clockTime(new Date(2026, 0, 1, 12, 0))).toBe('12:00 PM');
  });

  test('timer helpers', () => {
    expect(msUntilNextMinute(new Date(2026, 0, 1, 9, 0, 59, 500))).toBe(500);
    expect(msUntilMidnight(new Date(2026, 0, 1, 23, 59, 0))).toBe(60_000);
  });
});

describe('money is integer cents', () => {
  test.each([
    ['12', 1200],
    ['12.5', 1250],
    ['12.50', 1250],
    ['$12.50', 1250],
    [' 7 ', 700],
    ['.99', 99],
    ['0.10', 10],
    ['12,50', 1250],
    ['1,234', 123400],
    ['1,234.56', 123456],
  ])('parses %j as %i cents', (input, cents) => {
    expect(parseAmountToCents(input)).toBe(cents);
  });

  test.each(['', 'abc', '0', '0.00', '-5', '12.345', '1.2.3', '$', '.', '1e3', '10000000.01'])(
    'rejects %j',
    (input) => {
      expect(parseAmountToCents(input)).toBeNull();
    },
  );

  test('sums without floating-point drift', () => {
    const total = ['0.10', '0.20'].map((s) => parseAmountToCents(s)!).reduce((a, b) => a + b, 0);
    expect(formatCents(total)).toBe('$0.30');
  });

  test('formatting', () => {
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(123456789)).toBe('$1,234,567.89');
    expect(formatCentsCompact(4295)).toBe('$43');
    expect(formatCentsCompact(123456)).toBe('$1.2K');
    expect(formatCentsCompact(2_500_000)).toBe('$25K');
  });
});

describe('free tier', () => {
  test(`allows ${FREE_NOTES_PER_DAY} notes a day, premium unlimited`, () => {
    expect(canAddNote(0, false)).toBe(true);
    expect(canAddNote(FREE_NOTES_PER_DAY - 1, false)).toBe(true);
    expect(canAddNote(FREE_NOTES_PER_DAY, false)).toBe(false);
    expect(canAddNote(500, true)).toBe(true);
  });
});

test('the mock purchase succeeds without contacting anything', async () => {
  jest.useFakeTimers();
  const result = purchasePremiumMock();
  jest.advanceTimersByTime(600);
  await expect(result).resolves.toBe(true);
  jest.useRealTimers();
});
