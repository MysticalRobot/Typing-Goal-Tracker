import { 
  type DailyGoals, 
  type Store, 
  notifFrequencies, 
  type NotifFrequency, 
  type Message,
  type SerializedDate
} from './types.ts';

export function invariant(cond: any, msg?: string): asserts cond {
  if (!cond) {
    throw new Error(msg ?? 'Invariant failed');
  }
}

export function getRatio(timeMS: number, totalTimeMin: number): number {
  invariant(totalTimeMin > 0);
  const oneMinInMs = 60_000;
  return timeMS / (totalTimeMin * oneMinInMs);
}

export function sameDay(d1: Date, d2: Date): boolean {
  d1 = new Date(d1);
  d2 = new Date(d2);
  return d1.getUTCFullYear() == d2.getUTCFullYear()
  && d1.getUTCMonth() == d2.getUTCMonth()
  && d1.getUTCDay() == d2.getUTCDay()
}

export function getSerializedDate(d: Date): SerializedDate {
  return d.toUTCString();
}

export function getDate(d: SerializedDate): Date {
  return new Date(d);
}

export class StoreService {
  static defaultStore: Store = {
    timeTypedMS: 0,
    timeTypedDate: getSerializedDate(new Date()),
    // TODO revert to 0s
    dailyGoalsMin: [1, 1, 1, 1, 1, 1, 1], 
    notifFrequency: 'quarterGoalCompletion',
    trackedSites: [],
  } as const;
  static dailyGoalsOrder = [
    'sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'
  ] as const;
  static notifFrequencies: readonly NotifFrequency[] = notifFrequencies;
  static async get<T extends keyof Store>(key: T): Promise<Store[T]> {
    const storage = await browser.storage.sync.get(key);
    const value = storage[key] ?? this.defaultStore[key];
    this.set(key, value);
    return value;
  }
  static async set<T extends keyof Store>(key: T, value: Store[T]): Promise<void> {
    await browser.storage.sync.set({ [key]:value });
  }
}

export class SaveTimeTypedMessage implements Message {
  action: 'saveTimeTyped';
  timeTypedMS: number;
  constructor(timeTypedMS: number) {
    this.action = 'saveTimeTyped';
    this.timeTypedMS = timeTypedMS;
  }
  static isInstance(obj: any): boolean {
    return obj.action == 'saveTimeTyped' && typeof obj.timeTypedMS === 'number';
  }
}

export async function getDailyGoalMin(dailyGoalsMin: DailyGoals): Promise<number> {
  invariant(dailyGoalsMin.length === 7);
  const timeTypedDate = await StoreService.get('timeTypedDate');
  const timeTypedDayOfWeek = new Date(timeTypedDate).getUTCDay();
  return dailyGoalsMin.at(timeTypedDayOfWeek)!;
}
