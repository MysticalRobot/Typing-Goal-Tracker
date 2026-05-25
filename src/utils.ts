import { 
  type DailyGoals, 
  type Store, 
  type Message,
  type SerializedDate,
  type TempStore,
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

export function matchedByURLPattern(p1: string) {
  // IGNORE
  const p1Pattern = new URLPattern(p1);
  return (p2: string): boolean => {
    return p1 === p2 || p1Pattern.test(p2);
  };
}

export function matchesURLPattern(p1: string) {
  return (p2: string): boolean => {
    // IGNORE
    return p1 === p2 || new URLPattern(p2).test(p1);
  };
}

export function getTrackedSitePatternElement(
  trackedSitePattern: string
): HTMLDivElement {
  // `<div class="threeToOneSplit trackedSitePattern" >
  //   <span>${site}</span>
  //   <button class="hoverable">x</button>
  // </div>`
  const div = document.createElement('div');
  div.classList.add('threeToOneSplit', 'trackedSitePattern');
  const span = document.createElement('span');
  span.innerText = trackedSitePattern;
  const button = document.createElement('button');
  button.innerText = 'x';
  button.classList.add('hoverable');
  div.append(span, button);
  return div;
}

export function getContentScriptRegistrationDetails(
  trackedSitePatterns: string[]
) {
  return {
    id: 'time-typed-counter',
    js: ['./dist/content-script.js'],
    matches: trackedSitePatterns,
  }
}

export const defaultStore: Store = {
  timeTypedMS: 0,
  timeTypedDate: getSerializedDate(new Date()),
  // TODO revert to 0s
  dailyGoalsMin: [1, 1, 1, 1, 1, 1, 1], 
  notifPreference: 'never',
  reloadingPreference: 'off',
  trackedSitePatterns: [],
} as const;
export const dailyGoalsOrder = [
  'sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'
] as const;
export const notifPreferences = [
  'never', 'quarterGoalCompletion', 'halfGoalCompletion', 'goalCompletion'
] as const;
export const notifPermission: browser.permissions.Permissions = { 
  permissions: ['notifications'] 
} as const;
export const reloadingPreferences = ['off', 'on'] as const;

export function getSiteTrackingPermission(
  trackedSitePatterns: string[]
):  browser.permissions.Permissions {
  return { 
    // origins: ['<all_urls>'] 
    origins: trackedSitePatterns 
  };
}

export class StoreService {
  static async get<T extends keyof Store>(key: T): Promise<Store[T]> {
    const storage = await browser.storage.sync.get(key);
    const value = storage[key] ?? defaultStore[key];
    console.log(`retrieved ${key}:`, JSON.stringify(value))
    this.set(key, value);
    return value;
  }
  // TODO reject if too much
  // const getByteLength = (s: string) => new TextEncoder().encode(s).length;
  // const maxItemSize = 8192;
  static async set<T extends keyof Store>(key: T, value: Store[T]): Promise<void> {
    await browser.storage.sync.set({ [key]:value });
  }
}

const defaultTempStore: TempStore = { injectedTabs: [] } as const;

export class TempStoreService {
  static async get<T extends keyof TempStore>(key: T): Promise<TempStore[T]> {
    const storage = await browser.storage.session.get(key);
    const value = storage[key] ?? defaultTempStore[key];
    console.log(`retrieved ${key}:`, JSON.stringify(value))
    this.set(key, value);
    return value;
  }
  static async set<T extends keyof TempStore>(key: T, value: TempStore[T]): Promise<void> {
    await browser.storage.session.set({ [key]:value });
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
