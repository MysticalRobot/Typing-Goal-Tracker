import { invariant, getRatio, sameDay, getSerializedDate, getDate, StoreService, getDailyGoalMin, SaveTimeTypedMessage } from './utils';
import { type NotifFrequency } from './types';

async function getNotifText(
  notifFrequency: NotifFrequency, 
  dailyGoalMin: number, 
  prevTimeTypedMS: number, 
  currTimeTypedMS: number
): Promise<null | [string, string]> {
  invariant(
    dailyGoalMin > 0 && 0 <= prevTimeTypedMS && prevTimeTypedMS < currTimeTypedMS 
  );
  const prevProgressRatio = getRatio(prevTimeTypedMS, dailyGoalMin);
  const currProgressRatio = getRatio(currTimeTypedMS, dailyGoalMin);
  if (notifFrequency === 'quarterGoalCompletion'
    && prevProgressRatio < 0.25 && 0.25 <= currProgressRatio) {
    return ['one quarter goal complete', 'the hardest part is over, keep it up!'];
  } else if (notifFrequency === 'quarterGoalCompletion'
    && prevProgressRatio < 0.75 && 0.75 <= currProgressRatio) {
    return ['three quarters goal complete', 'can you finish the job?'];
  } else if ((notifFrequency === 'quarterGoalCompletion'
    || notifFrequency === 'halfGoalCompletion')
    && prevProgressRatio < 0.5 && 0.5 <= currProgressRatio) {
    return ['half goal complete', 'round 2, fight!'];
  } else if (prevProgressRatio < 1.0 && 1.0 <= currProgressRatio) {
    return ['goal complete', 'absolute cinema'];
  }
  return null;
}

async function sendNotif(title: string, message: string): Promise<void> {
  await browser.notifications.create({
    type: 'basic',
    iconUrl: browser.runtime.getURL('./assets/icon.svg'),
    title,
    message,
  });
}

async function saveTimeTypedAndNotifyUser(timeTypedMS: number) {
  invariant(timeTypedMS > 0);
  const prevTimeTypedDate = getDate(await StoreService.get('timeTypedDate'));
  const todayDate = new Date();
  if (!sameDay(prevTimeTypedDate, todayDate)) {
    await StoreService.set('timeTypedDate', getSerializedDate(todayDate));
    await StoreService.set('timeTypedMS', StoreService.defaultStore.timeTypedMS);
  }
  const prevTimeTypedMS = await StoreService.get('timeTypedMS');
  const currTimeTypedMS = prevTimeTypedMS + timeTypedMS;
  console.log(currTimeTypedMS / 1_000);
  await StoreService.set('timeTypedMS', currTimeTypedMS);

  const notifFrequency = await StoreService.get('notifFrequency');
  if (notifFrequency == 'never') {
    return;
  }
  const dailyGoalsMin = await StoreService.get('dailyGoalsMin');
  const dailyGoalMin = await getDailyGoalMin(dailyGoalsMin);
  if (dailyGoalMin === 0) {
    return;
  }
  const notifText = await getNotifText(
    notifFrequency, dailyGoalMin, prevTimeTypedMS, currTimeTypedMS
  );
  if (notifText !== null) {
    await sendNotif(...notifText);
  }
}

// Respond to messages from the content scripts
browser.runtime.onMessage.addListener((message) => {
  if (SaveTimeTypedMessage.isInstance(message)) {
      invariant(message.timeTypedMS > 0);
      saveTimeTypedAndNotifyUser(message.timeTypedMS);
  }
});

