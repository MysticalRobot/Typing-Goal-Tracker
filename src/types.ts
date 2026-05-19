export type DailyGoalInputs = [
  HTMLInputElement, HTMLInputElement, HTMLInputElement, HTMLInputElement, 
  HTMLInputElement, HTMLInputElement, HTMLInputElement
]

export type DailyGoals = [number, number, number, number, number, number, number];

export const notifFrequencies = [
  'never', 'quarterGoalCompletion', 'halfGoalCompletion', 'goalCompletion'
] as const;
export type NotifFrequency = typeof notifFrequencies[number];

export type SerializedDate = string;

export interface Store {
  timeTypedMS: number;
  timeTypedDate: SerializedDate;
  dailyGoalsMin: DailyGoals;
  notifFrequency: NotifFrequency;
  trackedSites: String[];
};

export interface Message {
  readonly action: string;
}
