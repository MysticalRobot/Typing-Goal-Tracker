import { notifPreferences, siteTrackingPreferences } from "./utils";

export type DailyGoalInputs = [
  HTMLInputElement, HTMLInputElement, HTMLInputElement, HTMLInputElement, 
  HTMLInputElement, HTMLInputElement, HTMLInputElement
]
export type DailyGoals = [number, number, number, number, number, number, number];
export type NotifPreference = typeof notifPreferences[number];
export type SiteTrackingPreference = typeof siteTrackingPreferences[number];
export type SerializedDate = string;

export interface Store {
  timeTypedMS: number;
  timeTypedDate: SerializedDate;
  dailyGoalsMin: DailyGoals;
  notifPreference: NotifPreference;
  siteTrackingPreference: SiteTrackingPreference;
  trackedSitePatterns: string[];
};

export type TabId = number;
export type URL = string
export type TabInfo = [TabId, URL];

export interface TempStore {
  injectedTabs: TabInfo[]
};

export type PreferenceOptions<T extends keyof Store> = 
  Store[T] extends string ? readonly Store[T][] : never;

export interface Message {
  readonly action: string;
}
