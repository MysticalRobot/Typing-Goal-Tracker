import { 
  invariant, 
  sameDay, 
  getSerializedDate, 
  getDate, 
  StoreService, 
  getDailyGoalMin, 
  SaveTimeTypedMessage, 
  defaultStore, 
  TempStoreService, 
  executeContentScript,
  getNotifText,
  sendNotif,
  ReloadInjectedButNotTrackedTabsMessage,
  InjectTrackedButNotInjectedTabsMessage
} from './utils';

async function saveTimeTypedAndNotifyUser(timeTypedMS: number): Promise<void> {
  invariant(timeTypedMS > 0);

  // Invalidate old saved timeTypedMS
  const prevTimeTypedDate = getDate(await StoreService.safeGet('timeTypedDate'));
  const todayDate = new Date();
  if (!sameDay(prevTimeTypedDate, todayDate)) {
    await StoreService.set('timeTypedDate', getSerializedDate(todayDate));
    await StoreService.set('timeTypedMS', defaultStore.timeTypedMS);
  }

  // Save new timeTypedMS
  const prevTimeTypedMS = await StoreService.safeGet('timeTypedMS');
  const currTimeTypedMS = prevTimeTypedMS + timeTypedMS;
  console.log('timeTypedS:', currTimeTypedMS / 1_000);
  await StoreService.set('timeTypedMS', currTimeTypedMS);

  // Notify user if goal checkpoint reached
  const notifPreference = await StoreService.safeGet('notifPreference');
  if (notifPreference == 'never') {
    return;
  }
  const dailyGoalsMin = await StoreService.safeGet('dailyGoalsMin');
  const dailyGoalMin = await getDailyGoalMin(dailyGoalsMin);
  if (dailyGoalMin === 0) {
    return;
  }
  const notifText = getNotifText(
    notifPreference, dailyGoalMin, prevTimeTypedMS, currTimeTypedMS
  );
  if (notifText !== null) {
    await sendNotif(...notifText);
  }
}

async function injectTrackedButNotInjectedTabs(
  trackedSitePatterns: URLPattern[], 
): Promise<void> {
  const injectedTabs = await TempStoreService.safeGet('injectedTabs');
  const tabs = await browser.tabs.query({});
  const validTabs = tabs.filter(
    (tab) => tab.id !== undefined && tab.url !== undefined
  );
  console.log(
    'valid tabs:', 
    JSON.stringify(validTabs.map((tab) => [tab.id, tab.url]))
  );
  const trackedButNotInjectedTabs = validTabs.filter(
    (tab) =>
    trackedSitePatterns.some((pattern) => pattern.test(tab.url))
    && !injectedTabs.some(([id, _]) => tab.id === id)
  );
  console.log(
    'injecting tracked tabs:', 
    JSON.stringify(trackedButNotInjectedTabs.map((tab) => [tab.id, tab.url]))
  );
  // Tabs with undefined ids and urls are filtered out above
  const newInjectedTabs = injectedTabs.concat(
    trackedButNotInjectedTabs.map((tab) => [tab.id!, tab.url!])
  );
  await Promise.all([
    trackedButNotInjectedTabs.map(
      (tab) => executeContentScript(tab.id!, 'background')
    ),
    TempStoreService.set('injectedTabs', newInjectedTabs)
  ]);
}

async function reloadInjectedButNotTrackedTabs(
  trackedSitePatterns: URLPattern[], 
): Promise<void> {
  const injectedTabs = await TempStoreService.safeGet('injectedTabs');
  const tabs = await browser.tabs.query({});
  const validTabs = tabs.filter(
    (tab) => tab.id !== undefined && tab.url !== undefined
  );
  console.log(
    'valid tabs:', 
    JSON.stringify(validTabs.map((tab) => [tab.id, tab.url]))
  );
  const injectedButNotTrackedTabs = validTabs.filter(
    (tab) =>
    !trackedSitePatterns.some((pattern) => pattern.test(tab.url))
    && injectedTabs.some(([id, _]) => tab.id === id)
  );
  console.log(
    'reloading injected tabs to stop script:', 
    JSON.stringify(injectedButNotTrackedTabs.map((tab) => [tab.id, tab.url]))
  );
  await Promise.all(
      // Tabs with undefined ids and urls are filtered out above
    injectedButNotTrackedTabs.map((tab) => browser.tabs.reload(tab.id!))
  );
  // Updating `injectedTabs` is done on reload
}

// Respond to messages from the content scripts
browser.runtime.onMessage.addListener(async (message, sender) => {
  const trackedSitePatterns = (await StoreService.safeGet('trackedSitePatterns'))
  .map((pattern) => new URLPattern(pattern));
  const isTabTracked = trackedSitePatterns.some(
    (pattern) => pattern.test(sender.tab?.url)
  );
  const injectedTabs = await TempStoreService.safeGet('injectedTabs');
  console.log('injectedTabs:', JSON.stringify(injectedTabs))
  if (isTabTracked && SaveTimeTypedMessage.isInstance(message)) {
    invariant(message.timeTypedMS > 0);
    await saveTimeTypedAndNotifyUser(message.timeTypedMS);
  } else if (ReloadInjectedButNotTrackedTabsMessage.isInstance(message)) {
    await reloadInjectedButNotTrackedTabs(trackedSitePatterns);
  } else if (InjectTrackedButNotInjectedTabsMessage.isInstance(message)) {
    await injectTrackedButNotInjectedTabs(trackedSitePatterns);
  }
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  // Need tabs permission to access changeInfo.url
  if (changeInfo.url === undefined) {
    return;
  }

  console.log('navigated to:', changeInfo.url);
  const trackedSitePatterns = (await StoreService.safeGet('trackedSitePatterns'))
  .map((pattern) => new URLPattern(pattern));
  const injectedTabs = await TempStoreService.safeGet('injectedTabs');
  const injectedTabIndex = injectedTabs.findIndex(([id, _]) => id === tabId);
  const wasInjectedTab = injectedTabIndex !== -1;
  const isNewSiteTracked = trackedSitePatterns.some(
    (pattern) => pattern.test(changeInfo.url)
  );

  if (wasInjectedTab && isNewSiteTracked) {
    injectedTabs.forEach
    const newInjectedTabs = injectedTabs
    .filter((_, i) => i !== injectedTabIndex)
    .concat([[tabId, changeInfo.url]]);
    console.log('updating url in TabInfo', JSON.stringify(newInjectedTabs));
    await TempStoreService.set('injectedTabs', newInjectedTabs);

  } else if (wasInjectedTab && changeInfo.status === 'loading') {
    const newInjectedTabs = injectedTabs.filter((_, i) => i !== injectedTabIndex);
    console.dir('removing TabInfo', JSON.stringify(newInjectedTabs));
    await TempStoreService.set('injectedTabs', newInjectedTabs);

  } else if (!wasInjectedTab && isNewSiteTracked) {
    const newInjectedTabs = injectedTabs.concat([[tabId, changeInfo.url]]);
    console.log(
      'injecting script and adding TabInfo', JSON.stringify(newInjectedTabs)
    );
    await Promise.all([
      executeContentScript(tabId, 'background'),
      TempStoreService.set('injectedTabs', newInjectedTabs)
    ]);
  }
});

browser.tabs.onRemoved.addListener(async (tabId) => {
  const injectedTabs = await TempStoreService.safeGet('injectedTabs');
  const newInjectedTabs = injectedTabs.filter(([id, _]) => id !== tabId);
  console.dir('removing TabInfo', JSON.stringify(newInjectedTabs));
  await TempStoreService.set('injectedTabs', newInjectedTabs);
});

browser.permissions.onAdded.addListener(async (permissions) => {
  console.log(JSON.stringify(permissions));
  const [notifPreference, trackedSitePatterns] = await Promise.all([
    TempStoreService.safeGet('notifPreference'),
    TempStoreService.safeGet('trackedSitePatterns')
  ]);
  const originPermissions = (permissions.origins ?? []).map(
    (pattern) => new URLPattern(pattern)
  );
  if (
    notifPreference !== null 
  && permissions.permissions?.includes('notifications')
  ) {
    await Promise.all([
      StoreService.set('notifPreference', notifPreference),
      TempStoreService.set('notifPreference', null)
    ]);
  } else if (trackedSitePatterns.every((p2) => originPermissions.some((p1) => p1.test(p2)))) {
    const oof = trackedSitePatterns.map((pattern) => new URLPattern(pattern));
    const [_, injectedTabs, tabs] = await Promise.all([
      StoreService.set('trackedSitePatterns', trackedSitePatterns),
      TempStoreService.safeGet('injectedTabs'),
      await browser.tabs.query({})
    ]);
    const trackedButNotInjectedTabs = tabs.filter(
      (tab) => 
      tab.id !== undefined 
      && tab.url !== undefined
      && oof.some((pattern) => pattern.test(tab.url))
      && !injectedTabs.some(([id, _]) => tab.id === id)
    ); 
    // Tabs with undefined ids are filtered out above
    const newInjectedTabs = injectedTabs.concat(
      trackedButNotInjectedTabs.map((tab) => [tab.id!, tab.url!])
    );
    await Promise.all([
      trackedButNotInjectedTabs.map(
        (tab) => executeContentScript(tab.id!, 'background')
      ),
      TempStoreService.set('injectedTabs', newInjectedTabs),
      TempStoreService.set('trackedSitePatterns', [])
    ]);
    console.log(
      'injected shits into', 
      JSON.stringify(trackedButNotInjectedTabs.map((tab) => [tab.id, tab.url]))
    );
  } 
});

// Purely for dealing with interactions from user in the manage extensions page
browser.permissions.onRemoved.addListener(async (permissions) => {
  console.log(JSON.stringify(permissions));
  const [notifPreference, trackedSitePatterns] = await Promise.all([
    TempStoreService.safeGet('notifPreference'),
    TempStoreService.safeGet('trackedSitePatterns')
  ]);
});

browser.runtime.onInstalled.addListener(async (details) => {
  // TODO reset for final extension
  // if (details.reason !== 'install') {
  //   return;
  // }
  const res = await browser.permissions.remove(
    { permissions: ['notifications'], origins: ['<all_urls>', 'https://monkeytype.com/*']}
  );
  if (res) {
    console.log('reset permissions');
  }

  await Promise.all(
    Object.entries(defaultStore).map(([key, value]) => StoreService.set(key, value))
  );
});
