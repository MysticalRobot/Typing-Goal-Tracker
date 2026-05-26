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

async function saveTimeTypedAndNotifyUser(
  timeTypedMS: number
): Promise<void | string> {
  invariant(timeTypedMS > 0);

  // Invalidate old saved timeTypedMS
  const prevTimeTypedDate = getDate(await StoreService.safeGet('timeTypedDate'));
  const todayDate = new Date();
  if (!sameDay(prevTimeTypedDate, todayDate)) {
    await Promise.all([
      StoreService.set('timeTypedDate', getSerializedDate(todayDate)),
      StoreService.set('timeTypedMS', defaultStore.timeTypedMS)
    ]);
  }

  // Save new timeTypedMS
  const [prevTimeTypedMS, notifPreference, dailyGoalsMin] = await Promise.all([
    StoreService.safeGet('timeTypedMS'),
    StoreService.safeGet('notifPreference'),
    StoreService.safeGet('dailyGoalsMin')
  ]);
  const currTimeTypedMS = prevTimeTypedMS + timeTypedMS;
  console.log('timeTypedS:', currTimeTypedMS / 1_000);
  await StoreService.set('timeTypedMS', currTimeTypedMS);

  // Notify user if goal checkpoint reached
  if (notifPreference == 'never') {
    return;
  }
  const dailyGoalMin = await getDailyGoalMin(dailyGoalsMin);
  if (dailyGoalMin === 0) {
    return;
  }
  const notifText = getNotifText(
    notifPreference, dailyGoalMin, prevTimeTypedMS, currTimeTypedMS
  );
  if (notifText !== null) {
    return sendNotif(...notifText);
  }
}

async function injectTrackedButNotInjectedTabs(
  trackedSitePatterns: URLPattern[], 
): Promise<[Promise<browser.scripting.InjectionResult[]>[], void]> {
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
  return Promise.all([
    trackedButNotInjectedTabs.map(
      (tab) => executeContentScript(tab.id!, 'background')
    ),
    TempStoreService.set('injectedTabs', newInjectedTabs)
  ]);
}

async function reloadInjectedButNotTrackedTabs(
  trackedSitePatterns: URLPattern[], 
): Promise<void[]> {
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
  return Promise.all(
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
    return saveTimeTypedAndNotifyUser(message.timeTypedMS);
  } else if (ReloadInjectedButNotTrackedTabsMessage.isInstance(message)) {
    return reloadInjectedButNotTrackedTabs(trackedSitePatterns);
  } else if (InjectTrackedButNotInjectedTabsMessage.isInstance(message)) {
    return injectTrackedButNotInjectedTabs(trackedSitePatterns);
  }
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  // Need tabs permission to access changeInfo.url
  if (changeInfo.url === undefined) {
    return;
  }

  console.log('navigated to:', changeInfo.url);
  const trackedSites = await StoreService.safeGet('trackedSitePatterns');
  console.log('trackedSites:', JSON.stringify(trackedSites));
  const trackedSitePatterns = trackedSites
  .map((pattern) => new URLPattern(pattern));
  const injectedTabs = await TempStoreService.safeGet('injectedTabs');
  const injectedTabIndex = injectedTabs.findIndex(([id, _]) => id === tabId);
  const wasInjectedTab = injectedTabIndex !== -1;
  const isNewSiteTracked = trackedSitePatterns.some(
    (pattern) => pattern.test(changeInfo.url)
  );

  if (wasInjectedTab && isNewSiteTracked && changeInfo.status === 'loading') {
    injectedTabs.forEach
    const newInjectedTabs = injectedTabs
    .filter((_, i) => i !== injectedTabIndex)
    .concat([[tabId, changeInfo.url]]);
    console.log(
      'updating url in TabInfo and reinjecting script:', 
      JSON.stringify(newInjectedTabs)
    );
    return Promise.all([
      executeContentScript(tabId, 'background'),
      TempStoreService.set('injectedTabs', newInjectedTabs)
    ]);

  } else if (wasInjectedTab && isNewSiteTracked) {
    injectedTabs.forEach
    const newInjectedTabs = injectedTabs
    .filter((_, i) => i !== injectedTabIndex)
    .concat([[tabId, changeInfo.url]]);
    console.log('updating url in TabInfo:', JSON.stringify(newInjectedTabs));
    return TempStoreService.set('injectedTabs', newInjectedTabs);

  } else if (wasInjectedTab && changeInfo.status === 'loading') {
    const newInjectedTabs = injectedTabs.filter((_, i) => i !== injectedTabIndex);
    console.log('removing TabInfo:', JSON.stringify(newInjectedTabs));
    return TempStoreService.set('injectedTabs', newInjectedTabs);

  } else if (!wasInjectedTab && isNewSiteTracked) {
    const newInjectedTabs = injectedTabs.concat([[tabId, changeInfo.url]]);
    console.log(
      'injecting script and adding TabInfo:', JSON.stringify(newInjectedTabs)
    );
    return Promise.all([
      executeContentScript(tabId, 'background'),
      TempStoreService.set('injectedTabs', newInjectedTabs)
    ]);
  }
});

browser.tabs.onRemoved.addListener(async (tabId) => {
  const injectedTabs = await TempStoreService.safeGet('injectedTabs');
  const newInjectedTabs = injectedTabs.filter(([id, _]) => id !== tabId);
  console.log('removing TabInfo:', JSON.stringify(newInjectedTabs));
  await TempStoreService.set('injectedTabs', newInjectedTabs);
});

browser.permissions.onAdded.addListener(async (permissions) => {
  console.log('added permissions:', JSON.stringify(permissions));
  const [notifPreference, trackedSitePatterns] = await Promise.all([
    TempStoreService.safeGet('notifPreference'),
    TempStoreService.safeGet('trackedSitePatterns')
  ]);

  if (
    notifPreference !== null 
  && permissions.permissions?.includes('notifications')
  ) {
    return Promise.all([
      StoreService.set('notifPreference', notifPreference),
      TempStoreService.set('notifPreference', null)
    ]);
  } 

  // TODO set the origins 
  const originPermissions = 
    (permissions.origins?.filter((origin) => origin !== '<all_urls>') ?? [])
  .map((pattern) => new URLPattern(pattern));
  if (!trackedSitePatterns.every((p2) => originPermissions.some((p1) => p1.test(p2)))) {
    return;
  }

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
    'injected shits into:', 
    JSON.stringify(trackedButNotInjectedTabs.map((tab) => [tab.id, tab.url]))
  );
});

// Purely for dealing with interactions from user in the manage extensions page
browser.permissions.onRemoved.addListener(async (permissions) => {
  console.log('removed permissions:', JSON.stringify(permissions));
  if (permissions.permissions?.includes('notifications')) {
    return StoreService.set('notifPreference', 'never');
  } 

  const trackedSitePatterns = await StoreService.safeGet('trackedSitePatterns');
  const originPermissions = 
    (permissions.origins?.filter((origin) => origin !== '<all_urls>') ?? [])
  .map((pattern) => new URLPattern(pattern));
  const newTrackedSitePatterns = trackedSitePatterns.filter(
    ([_, url]) => originPermissions.some((origin) => origin.test(url))
  );
  return StoreService.set('trackedSitePatterns', newTrackedSitePatterns);
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

  return Promise.all(
    Object.entries(defaultStore).map(([key, value]) => StoreService.set(key, value))
  );
});
