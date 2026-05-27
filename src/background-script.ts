import type { Message } from './types';
import { 
  invariant, 
  sameDay, 
  getSerializedDate, 
  getDate, 
  StoreService, 
  getDailyGoalMin, 
  defaultStore, 
  TempStoreService, 
  injectContentScript,
  getNotifText,
  sendNotif,
  defaultTempStore,
} from './utils';

async function saveTimeTypedAndNotifyUser(
  timeTypedMs: number
): Promise<void | string> {
  invariant(timeTypedMs > 0);
  const items = await StoreService.safeGetAll(
    'timeTypedDate', 'timeTypedMs', 'notifPreference', 'dailyGoalsMin'
  );

  // Invalidate old saved timeTypedMs
  const prevTimeTypedDate = getDate(items.timeTypedDate);
  const todayDate = new Date();
  if (!sameDay(prevTimeTypedDate, todayDate)) {
    await StoreService.set({ 
      timeTypedDate: getSerializedDate(todayDate),
      timeTypedMs: defaultStore.timeTypedMs
    });
  }

  // Save new timeTypedMs
  const currTimeTypedMs = items.timeTypedMs + timeTypedMs;
  console.log('timeTypedS:', currTimeTypedMs / 1_000);
  await StoreService.set({ timeTypedMs: currTimeTypedMs });

  // Notify user if goal checkpoint reached
  if (items.notifPreference == 'never') {
    return;
  }
  const dailyGoalMin = getDailyGoalMin(items.dailyGoalsMin, items.timeTypedDate);
  if (dailyGoalMin === 0) {
    return;
  }
  const notifText = getNotifText(
    items.notifPreference, dailyGoalMin, items.timeTypedMs, currTimeTypedMs
  );
  if (notifText !== null) {
    return sendNotif(...notifText);
  }
}

async function injectTrackedButNotInjectedTabs(
  trackedSitePatterns: URLPattern[], 
): Promise<[Promise<browser.scripting.InjectionResult[]>[], void]> {
  const [injectedTabs, tabs] = await Promise.all([
    TempStoreService.safeGet('injectedTabs'),
    browser.tabs.query({})
  ]);
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
      (tab) => injectContentScript(tab.id!, 'background')
    ),
    TempStoreService.set({ injectedTabs: newInjectedTabs })
  ]);
}

async function reloadInjectedButNotTrackedTabs(
  trackedSitePatterns: URLPattern[], 
): Promise<void[]> {
  const [injectedTabs, tabs] = await Promise.all([
    TempStoreService.safeGet('injectedTabs'),
    browser.tabs.query({})
  ]);
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
  // `injectedTabs` is updated on reload
}

// Respond to messages from the content scripts
browser.runtime.onMessage.addListener(async (message: Message, sender) => {
  const [trackedSites, injectedTabs] = await Promise.all([
    StoreService.safeGet('trackedSites'),
    TempStoreService.safeGet('injectedTabs')
  ]);
  console.log('injectedTabs:', JSON.stringify(injectedTabs))
  const trackedSitePatterns = trackedSites
  .map((pattern) => new URLPattern(pattern));
  const isTabTracked = trackedSitePatterns.some(
    (pattern) => pattern.test(sender.tab?.url)
  );
  if (message.action === 'saveTimeTyped' && isTabTracked) {
    invariant(message.timeTypedMs > 0);
    return saveTimeTypedAndNotifyUser(message.timeTypedMs);
  } else if (message.action === 'saveTimeTyped') {
    // Ignore 
  } else if (message.action === 'reloadInjectedButNotTrackedTabs') {
    return reloadInjectedButNotTrackedTabs(trackedSitePatterns);
  } else if (message.action === 'injectTrackedButNotInjectedTabs') {
    return injectTrackedButNotInjectedTabs(trackedSitePatterns);
  } else {
    invariant(false);
  }
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  // Need 'tabs' permission to access changeInfo.url
  if (changeInfo.url === undefined) {
    return;
  }

  console.log('navigated to:', changeInfo.url);
  const [trackedSites, injectedTabs] = await Promise.all([
    StoreService.safeGet('trackedSites'),
    TempStoreService.safeGet('injectedTabs')
  ]);
  console.log('trackedSites:', JSON.stringify(trackedSites));
  const trackedSitePatterns = trackedSites
  .map((pattern) => new URLPattern(pattern));
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
      injectContentScript(tabId, 'background'),
      TempStoreService.set({ injectedTabs: newInjectedTabs })
    ]);

  } else if (wasInjectedTab && isNewSiteTracked) {
    injectedTabs.forEach
    const newInjectedTabs = injectedTabs
    .filter((_, i) => i !== injectedTabIndex)
    .concat([[tabId, changeInfo.url]]);
    console.log('updating url in TabInfo:', JSON.stringify(newInjectedTabs));
    return TempStoreService.set({ injectedTabs: newInjectedTabs });

  } else if (wasInjectedTab && changeInfo.status === 'loading') {
    const newInjectedTabs = injectedTabs.filter((_, i) => i !== injectedTabIndex);
    console.log('removing TabInfo:', JSON.stringify(newInjectedTabs));
    return TempStoreService.set({ injectedTabs: newInjectedTabs });

  } else if (!wasInjectedTab && isNewSiteTracked) {
    const newInjectedTabs = injectedTabs.concat([[tabId, changeInfo.url]]);
    console.log(
      'injecting script and adding TabInfo:', JSON.stringify(newInjectedTabs)
    );
    return Promise.all([
      injectContentScript(tabId, 'background'),
      TempStoreService.set({ injectedTabs: newInjectedTabs })
    ]);
  }
});

browser.tabs.onRemoved.addListener(async (tabId) => {
  const injectedTabs = await TempStoreService.safeGet('injectedTabs');
  const newInjectedTabs = injectedTabs.filter(([id, _]) => id !== tabId);
  console.log('removing TabInfo:', JSON.stringify(newInjectedTabs));
  await TempStoreService.set({ injectedTabs: newInjectedTabs });
});

// TODO investigate: only umbrella permissions are given, does this cause any problems
browser.permissions.onAdded.addListener(async (permissions) => {
  console.log('added permissions:', JSON.stringify(permissions));
  const [tempItems, trackedSites] = await Promise.all([
    TempStoreService.safeGetAll('notifPreference', 'trackedSites'),
    StoreService.safeGet('trackedSites')
  ]);

  if (
    tempItems.notifPreference !== null 
  && permissions.permissions?.includes('notifications')
  ) {
    return Promise.all([
      StoreService.set({ notifPreference: tempItems.notifPreference }),
      TempStoreService.set({ notifPreference: defaultTempStore.notifPreference })
    ]);
  } 

  const origins = permissions.origins?.filter(
    (origin) => origin !== '<all_urls>'
  ) ?? [];
  const originPatterns = origins.map((origin) => new URLPattern(origin));
  const isPermissionAddedFromPopup = tempItems.trackedSites.length !== 0;
  const newTrackedSites = isPermissionAddedFromPopup 
  ? tempItems.trackedSites
  : origins.concat(
    trackedSites.filter(
      (site) => !originPatterns.some((pattern) => pattern.test(site))
    )
  );
  const newTrackedSitePatterns = newTrackedSites.map((s) => new URLPattern(s));
  const [_, injectedTabs, tabs] = await Promise.all([
    StoreService.set({ trackedSites: newTrackedSites }),
    TempStoreService.safeGet('injectedTabs'),
    await browser.tabs.query({})
  ]);
  const trackedButNotInjectedTabs = tabs.filter(
    (tab) => 
    tab.id !== undefined 
    && tab.url !== undefined
    && newTrackedSitePatterns.some((pattern) => pattern.test(tab.url))
    && !injectedTabs.some(([id, _]) => tab.id === id)
  ); 
  // Tabs with undefined ids are filtered out above
  const newInjectedTabs = injectedTabs.concat(
    trackedButNotInjectedTabs.map((tab) => [tab.id!, tab.url!])
  );
  await Promise.all([
    trackedButNotInjectedTabs.map(
      (tab) => injectContentScript(tab.id!, 'background')
    ),
    TempStoreService.set({ 
      injectedTabs: newInjectedTabs,
      trackedSites: defaultTempStore.trackedSites
    })
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
    return StoreService.set({ notifPreference: 'never' });
  } 

  const items = await StoreService.safeGetAll('trackedSites', 'reloadingPreference');
  const origins = permissions.origins?.filter((o) => o !== '<all_urls>') ?? [];
  const originPatterns = origins.map((o) => new URLPattern(o));
  const newTrackedSites = items.trackedSites.filter(
    (site) => !originPatterns.some((pattern) => pattern.test(site))
  );
  if (items.reloadingPreference === 'off') {
    return StoreService.set({ trackedSites: newTrackedSites });
  } else {
    return Promise.all([
      StoreService.set({ trackedSites: newTrackedSites }),
      reloadInjectedButNotTrackedTabs(
        newTrackedSites.map((site) => new URLPattern(site))
      )
    ]);
  }
});

browser.runtime.onInstalled.addListener(async (details) => {
  // TODO reset for final extension
  // if (details.reason !== 'install') {
  //   return;
  // }
  await browser.permissions.remove({ 
    permissions: ['notifications'], 
    origins: ['<all_urls>', 'https://monkeytype.com/*']
  });

  // KEEP
  return StoreService.set(defaultStore);
});
