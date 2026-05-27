import { 
  invariant, 
  getRatio, 
  StoreService, 
  getDailyGoalMin, 
  matchedByURLPattern, 
  matchesURLPattern, 
  getTrackedSiteElement, 
  notifPreferences, 
  dailyGoalsOrder, 
  notifPermission, 
  TempStoreService, 
  getSiteTrackingPermission, 
  reloadingPreferences,
  defaultTempStore, 
} from '../utils';
import { 
  type DailyGoalInputs, 
  type DailyGoals,
  type PreferenceOptions,
  type Store,
  type Message,
  type NotifPreference,
  type ReloadingPreference
} from '../types';

async function displayProgress(
  progressBar: HTMLProgressElement, dailyGoalsMin: DailyGoals
): Promise<void> {
  const items = await StoreService.safeGetAll('timeTypedMs', 'timeTypedDate');
  const dailyGoalMin = getDailyGoalMin(dailyGoalsMin, items.timeTypedDate);
  const maxProgressValue = 100;
  if (dailyGoalMin === 0) {
    progressBar.value = maxProgressValue;
  } else {
    const progressRatio = getRatio(items.timeTypedMs, dailyGoalMin);
    progressBar.value = Math.min(maxProgressValue, progressRatio * 100);
  }
}

async function displayDailyGoals(
  dailyGoalInputs: DailyGoalInputs, dailyGoalsMin: DailyGoals
): Promise<void> {
  dailyGoalInputs.forEach(
    (input, i) => input.value = dailyGoalsMin.at(i)!.toString()
  );
}

function getDailyGoalsFormHandler(dailyGoalInputs: DailyGoalInputs) {
  return async function saveDailyGoals() {
    const dailyGoalsMin = dailyGoalInputs.map((input) => input.valueAsNumber);
    const hasNumericGoalValues = !dailyGoalsMin.some(Number.isNaN);
    invariant(hasNumericGoalValues);
    await StoreService.set({ dailyGoalsMin: dailyGoalsMin as DailyGoals });
  }
}

async function displayRadioButtons<T extends keyof Store>(
  form: HTMLFormElement, key: T, preferenceValues: PreferenceOptions<T>
): Promise<void> {
  const value = await StoreService.safeGet(key);
  const buttons = Array.from(form.children).filter(
    (e) => e instanceof HTMLButtonElement
  );
  const hasCorrectButtons = buttons.every(
    (button, i) => button.getAttribute('data-value') === preferenceValues.at(i)
  );
  invariant(hasCorrectButtons);
  const correspondingButton = buttons.find(
    (button) => button.getAttribute('data-value') === value
  );
  correspondingButton!.setAttribute('data-checked', 'true');
}

async function notifPreferenceFormHandler(e: PointerEvent): Promise<any> {
  if (!(e.target instanceof HTMLButtonElement)) {
    return;
  }
  const value = e.target.getAttribute('data-value') ?? ''; 
  const valueIndex = notifPreferences.indexOf(value);
  invariant(valueIndex !== -1);
  const isRemovingPermission = value === 'never';
  if (isRemovingPermission) {
    console.log('removing permission:', JSON.stringify(notifPermission));
    return Promise.all([
      // If permission does not exist, then does nothing and succeeds 
      browser.permissions.remove(notifPermission),
      StoreService.set({ notifPreference: value })
    ]);
  } 

  console.log('requesting permission:', JSON.stringify(notifPermission));
  // The concurrency of `Promise.all` preserves the condition: 
  // 'permissions.request may only be called from a user input handler' 
  const [_, isPermissionGranted] = await Promise.all([
    TempStoreService.set({ notifPreference: value as NotifPreference }), 
    // If permission is already granted, then does nothing and succeeds 
    browser.permissions.request(notifPermission)
  ]);
  // User may have granted the permission in the extension settings
  // TODO show error if not
  if (isPermissionGranted) {
    return Promise.all([
      TempStoreService.set({ notifPreference: defaultTempStore.notifPreference }),
      StoreService.set({ notifPreference: value as NotifPreference }), 
    ]);
  }
}

async function reloadingPreferenceFormHandler(e: PointerEvent): Promise<void> {
  if (!(e.target instanceof HTMLButtonElement)) {
    return;
  }
  const value = e.target.getAttribute('data-value') ?? ''; 
  const valueIndex = reloadingPreferences.indexOf(value);
  invariant(valueIndex !== -1);
  await StoreService.set({ reloadingPreference: value as ReloadingPreference });
  const isRemovingPermission = value === 'off';
  if (isRemovingPermission) { 
    return;
  } 
  const message: Message = { action: 'reloadInjectedButNotTrackedTabs' };
  await browser.runtime.sendMessage(message);
  location.reload();
} 

async function displayPopupToggle(popupToggle: HTMLSpanElement) {
  const extensionCmds = await browser.commands.getAll();
  const popupToggleName = '_execute_action';
  const cmdIndex = extensionCmds.findIndex((cmd) => cmd.name === popupToggleName);
  invariant(cmdIndex !== -1);
  const cmdShortcut = extensionCmds.at(cmdIndex)!.shortcut?.toLocaleLowerCase();
  popupToggle.innerText = cmdShortcut ?? 'Failed to get command';
}

function getTrackedSites(trackedSiteElements: HTMLElement): string[] {
  return Array.from(trackedSiteElements.children).map((trackedSiteElement) => {
    const span = trackedSiteElement.firstElementChild;
    invariant(span instanceof HTMLSpanElement);
    return span.innerText;
  });
}

function getTrackedSitesFormHandler(
  trackedSiteInput: HTMLInputElement, trackedSitesElement: HTMLElement
) {
  return async function trackSite() {
    const newSite = trackedSiteInput.value;
    invariant(newSite.length > 0);
    // no need to do this (can pass in)
    const trackedSites = getTrackedSites(trackedSitesElement);
    const matchedByNewPattern = matchedByURLPattern(newSite);
    const newTrackedSites = trackedSites.filter(
      (trackedSite) => !matchedByNewPattern(trackedSite)
    );
    const isNewSiteTracked = newTrackedSites.some(
      (trackedSite) => matchesURLPattern(trackedSite)(newSite)
    );
    if (!isNewSiteTracked) {
      newTrackedSites.push(newSite);
    }
    const isChangeInTrackedSites = !isNewSiteTracked ||
      trackedSites.length !== newTrackedSites.length
    if (!isChangeInTrackedSites) {
      return;
    }
    try {
      const siteTrackingPermission = getSiteTrackingPermission(newTrackedSites);
      const [_, isPermissionGranted] = await Promise.all([
        TempStoreService.set({ trackedSites: newTrackedSites }),
        browser.permissions.request(siteTrackingPermission),
      ]); 
      // User may have granted the permission in the extension settings
      if (!isPermissionGranted) {
        throw new Error('Failed to get permission');
      }
      const message: Message = { action: 'injectTrackedButNotInjectedTabs' };
      return Promise.all([
        TempStoreService.set({ trackedSites: defaultTempStore.trackedSites }),
        StoreService.set({ trackedSites: newTrackedSites }),
        browser.runtime.sendMessage(message)
      ]);
    } catch (error) {
      console.error(error);
      invariant(error instanceof Error);
      trackedSiteInput.setCustomValidity(error.message);
      // TODO show error, but accept input, so that opening only on sites that
      // are wanted show permission status in frontend
    }
  };
}

async function displayTrackedSites(
  trackedSitesElement: HTMLElement
): Promise<void> {
  const trackedSites = await StoreService.safeGet('trackedSites');
  const trackedSiteElements = trackedSites.map(
    getTrackedSiteElement
  );
  trackedSitesElement.append(...trackedSiteElements);
}

async function trackedSitesHandler(e: PointerEvent): Promise<void> {
  if (!(e.target instanceof HTMLButtonElement)) {
    return;
  }
  const span = e.target.previousElementSibling;
  invariant(span instanceof HTMLSpanElement);
  const [items, injectedTabs] = 
    await Promise.all([
    StoreService.safeGetAll('trackedSites', 'reloadingPreference'),
    TempStoreService.safeGet('injectedTabs')
  ]);
  invariant(items.trackedSites.includes(span.innerText));
  const newTrackedSites = items.trackedSites.filter(
    (trackedSite) => trackedSite !== span.innerText
  ); 
  const [_, res] = await Promise.all([
    StoreService.set({ trackedSites: newTrackedSites }),
    browser.permissions.remove(getSiteTrackingPermission([span.innerText]))
  ]);
  if (!res) {
    return;
  }
  console.log('removed permission for:', span.innerText);
  if (items.reloadingPreference === 'on') {
    const removedSitePattern = new URLPattern(span.innerText);
    const injectedButNotTrackedTabs = injectedTabs.filter(
      ([_, url]) => removedSitePattern.test(url)
    );
    console.log(
      'reloading injected but not tracked tabs:',
      JSON.stringify(injectedButNotTrackedTabs)
    );
    await Promise.all(
      injectedButNotTrackedTabs.map(([id, _]) => browser.tabs.reload(id))
    );
  }
  location.reload();
  // No need to remove from injection flag from temp store, that is handled by bg script
}

async function main() {  
  const dailyGoalsMin = await StoreService.safeGet('dailyGoalsMin');

  const progressBar = document.getElementById('progressBar');
  invariant(progressBar instanceof HTMLProgressElement);
  await displayProgress(progressBar, dailyGoalsMin);
 
  const dailyGoalInputs = Array.from(
    document.getElementsByClassName('dailyGoalInput')
  );
  const areInputs = dailyGoalInputs.every((el) => el instanceof HTMLInputElement);
  const hasInputForEachDayInOrder = dailyGoalsOrder.every(
    (day, i) => day === dailyGoalInputs.at(i)?.id
  );
  invariant(areInputs && hasInputForEachDayInOrder);
  await displayDailyGoals(dailyGoalInputs as DailyGoalInputs, dailyGoalsMin);

  const dailyGoalsForm = document.getElementById('dailyGoalsForm');
  invariant(dailyGoalsForm instanceof HTMLFormElement);
  dailyGoalsForm.addEventListener(
    'submit', getDailyGoalsFormHandler(dailyGoalInputs as DailyGoalInputs)
  );

  const notifPreferenceForm = document.getElementById('notifPreferenceForm');
  invariant(notifPreferenceForm instanceof HTMLFormElement)
  await displayRadioButtons(
    notifPreferenceForm, 'notifPreference', notifPreferences
  );
  // 'submit' makes the event target the form, preventing event delegation
  notifPreferenceForm.addEventListener('click', notifPreferenceFormHandler)

  const popupToggle = document.getElementById('popupToggle');
  invariant(popupToggle !== null);
  await displayPopupToggle(popupToggle);

  const editPopupToggleLink = document.getElementById('editPopupToggleLink');
  invariant(editPopupToggleLink !== null);
  // IGNORE
  editPopupToggleLink.addEventListener('click', browser.commands.openShortcutSettings);
 
  const reloadingPreferenceForm = document.getElementById('reloadingPreferenceForm');
  invariant(reloadingPreferenceForm instanceof HTMLFormElement);
  await displayRadioButtons(
    reloadingPreferenceForm, 'reloadingPreference', reloadingPreferences
  );
  reloadingPreferenceForm.addEventListener('click', reloadingPreferenceFormHandler);

  const trackedSitesElement = document.getElementById('trackedSites');
  invariant(trackedSitesElement !== null);
  await displayTrackedSites(trackedSitesElement);
  trackedSitesElement.addEventListener('click', trackedSitesHandler);

  const trackedSiteInput = document.getElementById('trackedSiteInput');
  invariant(trackedSiteInput instanceof HTMLInputElement);
  const trackedSitesForm = document.getElementById('trackedSitesForm');
  invariant(trackedSitesForm instanceof HTMLFormElement);
  trackedSitesForm.addEventListener(
    'submit', 
    getTrackedSitesFormHandler(trackedSiteInput, trackedSitesElement)
  );
}

main().catch((e) => console.error(e));
