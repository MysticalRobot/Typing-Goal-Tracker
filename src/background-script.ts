import { invariant, getRatio, sameDay, getSerializedDate, getDate, StoreService, getDailyGoalMin, SaveTimeTypedMessage, defaultStore, TempStoreSerice } from './utils';
import { type NotifPreference } from './types';

async function getNotifText(
  notifPreference: NotifPreference, 
  dailyGoalMin: number, 
  prevTimeTypedMS: number, 
  currTimeTypedMS: number
): Promise<null | [string, string]> {
  invariant(
    dailyGoalMin > 0 && 0 <= prevTimeTypedMS && prevTimeTypedMS < currTimeTypedMS 
  );
  // TODO maybe move the ratios out, create another func for 
  // updating the icon based on progress
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

  // Invalidate old saved timeTypedMS
  const prevTimeTypedDate = getDate(await StoreService.get('timeTypedDate'));
  const todayDate = new Date();
  if (!sameDay(prevTimeTypedDate, todayDate)) {
    await StoreService.set('timeTypedDate', getSerializedDate(todayDate));
    await StoreService.set('timeTypedMS', defaultStore.timeTypedMS);
  }

  // Save new timeTypedMS
  const prevTimeTypedMS = await StoreService.get('timeTypedMS');
  const currTimeTypedMS = prevTimeTypedMS + timeTypedMS;
  console.log(currTimeTypedMS / 1_000);
  await StoreService.set('timeTypedMS', currTimeTypedMS);

  // Notify user if goal checkpoint reached
  const notifPreference = await StoreService.get('notifPreference');
  if (notifPreference == 'never') {
    return;
  }
  const dailyGoalsMin = await StoreService.get('dailyGoalsMin');
  const dailyGoalMin = await getDailyGoalMin(dailyGoalsMin);
  if (dailyGoalMin === 0) {
    return;
  }
  const notifText = await getNotifText(
    notifPreference, dailyGoalMin, prevTimeTypedMS, currTimeTypedMS
  );
  if (notifText !== null) {
    await sendNotif(...notifText);
  }
}

async function executeContentScriptForTrackedSite(
  activeInfo: browser.tabs._OnActivatedActiveInfo
): Promise<void> {
  const trackedSitePatterns = await StoreService.get('trackedSitePatterns');
  const activeTabId = activeInfo.tabId;
  const activeTab = await browser.tabs.get(activeTabId);
  const activeURL = activeTab?.url ?? '';
  const activeTabIsTracked = trackedSitePatterns.some(
    // IGNORE
    (trackedPattern) => new URLPattern(trackedPattern).test(activeURL)
  );
  console.log(activeURL);
  if (!activeTabIsTracked) {
    return;
  }
  console.log('matching tab');
  const permissions = await browser.permissions.getAll();
  console.dir(permissions);
  const rcs = await browser.scripting.getRegisteredContentScripts();
  console.dir(rcs);
  // try {
  //   const permissions = await browser.permissions.getAll();
  //   console.dir(permissions);
  //   const rcs = await browser.scripting.getRegisteredContentScripts();
  //   console.dir(rcs);
  //   await browser.scripting.executeScript({
  //     target: { tabId: activeTabId, allFrames: true },
  //     // target: { tabId: activeTabId },
  //     files: ['./dist/content-script.js'],
  //   }); 
  // } catch (e) {
  //   console.dir(e);
  // }
}
/*
 * all urls permission (scary), register content script upon addition/removal of patterns
 *  - need site input
 * activeTab permission, on popup opening -> execute script
 *  - (automatically) stops when url changes, reload
 *  - reload upon removal of script.
 *  - need to ensure it only happens once: flag is local store, reset upon change from tab listener
 */

// Respond to messages from the content scripts
browser.runtime.onMessage.addListener(async (message, sender) => {
  const injectedTabs = await TempStoreSerice.get('injectedTabs');
  // A message might come from a tab that was originally on a tracked site (e.g. 
  // https://monkeytype.com/ -> https://monkeytype.com/settings) if the tab didn't reload.
  // In this case, the tab won't be registered as injected, but it will still be, so
  // its messages needs to be rejected.
  const isSiteTracked = injectedTabs.some(([id, _]) => id == sender.tab?.id);
  if (isSiteTracked && SaveTimeTypedMessage.isInstance(message)) {
      invariant(message.timeTypedMS > 0);
      await saveTimeTypedAndNotifyUser(message.timeTypedMS);
  }
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  // Need tabs permission to access changeInfo.url
  // if shit is genuinely loading!!
  console.log(changeInfo.status);
  if (changeInfo.url === undefined) {
    return;
  }
  console.log('navigated to:', changeInfo.url);
  const trackedSitePatterns = (await StoreService.get('trackedSitePatterns'))
  .map((pattern) => new URLPattern(pattern));
  const injectedTabs = await TempStoreSerice.get('injectedTabs');
  const injectedTabIndex = injectedTabs.findIndex(([id, _]) => id === tabId);
  const wasInjectedTab = injectedTabIndex !== -1;
  const isNewSiteTracked = trackedSitePatterns.some((pattern) => pattern.test(changeInfo.url));
  if (wasInjectedTab && isNewSiteTracked) {
    injectedTabs.forEach
    const newInjectedTabs = injectedTabs
    .filter((_, i) => i !== injectedTabIndex)
    .concat([[tabId, changeInfo.url]]);
    console.log('updating url in TabInfo', JSON.stringify(newInjectedTabs));
    await TempStoreSerice.set('injectedTabs', newInjectedTabs);
  } else if (wasInjectedTab) {
    // TODO need to reload
    const newInjectedTabs = injectedTabs.filter((_, i) => i !== injectedTabIndex);
    console.dir('removing TabInfo', JSON.stringify(newInjectedTabs));
    await TempStoreSerice.set('injectedTabs', newInjectedTabs);
  } else if (isNewSiteTracked && changeInfo.status === 'complete') {
    const newInjectedTabs = injectedTabs.concat([[tabId, changeInfo.url]]);
    console.log('adding TabInfo', JSON.stringify(newInjectedTabs));
    await TempStoreSerice.set('injectedTabs', newInjectedTabs);
  }
});

browser.tabs.onRemoved.addListener(async (tabId) => {
  // TODO reload if desired
  const injectedTabs = await TempStoreSerice.get('injectedTabs');
  const newInjectedTabs = injectedTabs.filter(([id, _]) => id !== tabId);
  console.dir(newInjectedTabs);
  await TempStoreSerice.set('injectedTabs', newInjectedTabs);
});

// TODO add temp store service maybe 
browser.runtime.onInstalled.addListener(async () => {
  await Promise.all(Object.entries(defaultStore).map(([key, value]) => StoreService.set(key, value)));
  const siteTrackingPreference = await StoreService.get('siteTrackingPreference');
  if (siteTrackingPreference === 'off') {
    return;
  }
  const trackedSitePatterns = await StoreService.get('trackedSitePatterns');
  try {
    if (trackedSitePatterns.length !== 0) {
      // await browser.scripting.registerContentScripts(
      //   [getContentScriptRegistrationDetails(trackedSitePatterns)]
      // )
    } 
  } catch (error) {
    console.dir(error);
  }
});
