import { notifPreferences, reloadingPreferences } from "./utils";

export type DailyGoalInputs = [
  HTMLInputElement, HTMLInputElement, HTMLInputElement, HTMLInputElement, 
  HTMLInputElement, HTMLInputElement, HTMLInputElement
];
export type DailyGoals = [number, number, number, number, number, number, number];
export type NotifPreference = typeof notifPreferences[number];
export type ReloadingPreference = typeof reloadingPreferences[number];
export type SerializedDate = string;

export interface Store {
  timeTypedMs: number;
  timeTypedDate: SerializedDate;
  dailyGoalsMin: DailyGoals;
  notifPreference: NotifPreference;
  reloadingPreference: ReloadingPreference;
  trackedSites: string[];
};

export type Id = number;
export type URL = string
export type TabInfo = [Id, URL];

export interface TempStore {
  injectedTabs: TabInfo[];
  notifPreference: NotifPreference | null;
  trackedSites: string[];
};

export type Items<S, T extends keyof S> = { [K in T]: S[K] };

export type PreferenceOptions<T extends keyof Store> = 
  Store[T] extends string ? readonly Store[T][] : never;

export type Message =
| { action: 'saveTimeTyped'; timeTypedMs: number }
| { action: 'injectTrackedButNotInjectedTabs' }
| { action: 'reloadInjectedButNotTrackedTabs' };

