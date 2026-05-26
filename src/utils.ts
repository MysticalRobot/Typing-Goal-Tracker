import { 
  type DailyGoals, 
  type Store, 
  type Message,
  type SerializedDate,
  type TempStore,
  type NotifPreference,
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

export function getNotifText(
  notifPreference: NotifPreference, 
  dailyGoalMin: number, 
  prevTimeTypedMS: number, 
  currTimeTypedMS: number
): null | [string, string] {
  invariant(
    dailyGoalMin > 0 && 0 <= prevTimeTypedMS && prevTimeTypedMS < currTimeTypedMS 
  );
  // TODO maybe move the ratios out, create another func for updating the icon based on progress
  const prevProgressRatio = getRatio(prevTimeTypedMS, dailyGoalMin);
  const currProgressRatio = getRatio(currTimeTypedMS, dailyGoalMin);

  if (notifPreference === 'quarterGoalCompletion'
    && prevProgressRatio < 0.25 && 0.25 <= currProgressRatio) {
    return ['one quarter goal complete', 'the hardest part is over, keep it up!'];

  } else if (notifPreference === 'quarterGoalCompletion'
    && prevProgressRatio < 0.75 && 0.75 <= currProgressRatio) {
    return ['three quarters goal complete', 'can you finish the j*b?'];

  } else if ((notifPreference === 'quarterGoalCompletion'
    || notifPreference === 'halfGoalCompletion')
    && prevProgressRatio < 0.5 && 0.5 <= currProgressRatio) {
    return ['half goal complete', 'round 2, fight!'];

  } else if (prevProgressRatio < 1.0 && 1.0 <= currProgressRatio) {
    return ['goal complete', 'absolute cinema'];
  }

  return null;
}

export function sendNotif(title: string, message: string): Promise<string> {
  return browser.notifications.create({
    type: 'basic',
    iconUrl: browser.runtime.getURL('./assets/icon.svg'),
    title,
    message,
  });
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
  const p1Pattern = new URLPattern(p1);
  return (p2: string): boolean => {
    return p1 === p2 || p1Pattern.test(p2);
  };
}

export function matchesURLPattern(p1: string) {
  return (p2: string): boolean => {
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

export function executeContentScript(
  tabId: number, injectingScript: 'background' | 'popup'
): Promise<browser.scripting.InjectionResult[]> {
  const scriptRoot = injectingScript === 'background' ? './dist/' : './';
  return browser.scripting.executeScript({
    target: { tabId, allFrames: false },
    files: [scriptRoot + 'content-script.js'],
  })
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
    origins: trackedSitePatterns 
  };
}

export class StoreService {
  static async safeGet<T extends keyof Store>(key: T): Promise<Store[T]> {
    const storage = await browser.storage.sync.get(key);
    const value = storage[key] ?? defaultStore[key];
    return value;
  }
  // TODO reject if too much
  // const getByteLength = (s: string) => new TextEncoder().encode(s).length;
  // const maxItemSize = 8192;
  static async set<T extends keyof Store>(key: T, value: Store[T]): Promise<void> {
    await browser.storage.sync.set({ [key]:value });
  }
}

const defaultTempStore: TempStore = { 
  injectedTabs: [], 
  notifPreference: null, 
  trackedSitePatterns: [],
} as const;

export class TempStoreService {
  static async safeGet<T extends keyof TempStore>(key: T): Promise<TempStore[T]> {
    const storage = await browser.storage.session.get(key);
    const value = storage[key] ?? defaultTempStore[key];
    return value;
  }
  // TODO reject if too much
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

export class InjectTrackedButNotInjectedTabsMessage implements Message {
  action: 'injectTrackedButNotInjectedTabs';
  constructor() {
    this.action = 'injectTrackedButNotInjectedTabs';
  }
  static isInstance(obj: any): boolean {
    return obj.action == 'injectTrackedButNotInjectedTabs';
  }
}

export class ReloadInjectedButNotTrackedTabsMessage implements Message {
  action: 'reloadInjectedButNotTrackedTabs';
  constructor() {
    this.action = 'reloadInjectedButNotTrackedTabs';
  }
  static isInstance(obj: any): boolean {
    return obj.action == 'reloadInjectedButNotTrackedTabs';
  }
}

export async function getDailyGoalMin(dailyGoalsMin: DailyGoals): Promise<number> {
  invariant(dailyGoalsMin.length === 7);
  const timeTypedDate = await StoreService.safeGet('timeTypedDate');
  const timeTypedDayOfWeek = new Date(timeTypedDate).getUTCDay();
  return dailyGoalsMin.at(timeTypedDayOfWeek)!;
}
