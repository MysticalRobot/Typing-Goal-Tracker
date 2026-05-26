import { 
  invariant, 
  getRatio, 
  StoreService, 
  getDailyGoalMin, 
  matchedByURLPattern, 
  matchesURLPattern, 
  getTrackedSitePatternElement, 
  notifPreferences, 
  dailyGoalsOrder, 
  notifPermission, 
  TempStoreService, 
  getSiteTrackingPermission, 
  reloadingPreferences, 
  ReloadInjectedButNotTrackedTabsMessage,
  InjectTrackedButNotInjectedTabsMessage
} from '../utils';
import { 
  type DailyGoalInputs, 
  type DailyGoals,
  type PreferenceOptions,
  type Store,
} from '../types';

async function displayProgress(
  progressBar: HTMLProgressElement, dailyGoalsMin: DailyGoals
): Promise<void> {
  const [timeTypedMS, dailyGoalMin] = await Promise.all([
    StoreService.safeGet('timeTypedMS'),
    getDailyGoalMin(dailyGoalsMin)
  ]);
  const maxProgressValue = 100;
  if (dailyGoalMin === 0) {
    progressBar.value = maxProgressValue;
  } else {
    const progressRatio = getRatio(timeTypedMS, dailyGoalMin);
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
    await StoreService.set('dailyGoalsMin', dailyGoalsMin as DailyGoals);
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

async function notifPreferenceFormHandler(e: PointerEvent): Promise<void> {
  if (!(e.target instanceof HTMLButtonElement)) {
    return;
  }
  const value = e.target.getAttribute('data-value') ?? ''; 
  const valueIndex = notifPreferences.indexOf(value);
  invariant(valueIndex !== -1);
  const isRemovingPermission = value === 'never';
  if (isRemovingPermission) {
    console.log('removing permission');
    await Promise.all([
      // If permission does not exist, then does nothing and succeeds 
      browser.permissions.remove(notifPermission),
      StoreService.set('notifPreference', value)
    ]);
  } else {
    console.log('requesting permission');
    // `Promise.all` preserves the condition: 
    // 'permissions.request may only be called from a user input handler' 
    const [_, __, isPermissionGranted] = await Promise.all([
      TempStoreService.set('notifPreference', value), 
      // If permission is already granted, then does nothing and succeeds 
      browser.permissions.request(notifPermission),
      browser.permissions.contains(notifPermission)
    ]);
    // User may have granted the permission in the extension settings
    // TODO show error if not
    if (isPermissionGranted) {
      await Promise.all([
        TempStoreService.set('notifPreference', null),
        StoreService.set('notifPreference', value)
      ]);
    }
  } 
}

async function reloadingPreferenceFormHandler(e: PointerEvent): Promise<void> {
  if (!(e.target instanceof HTMLButtonElement)) {
    return;
  }
  const value = e.target.getAttribute('data-value') ?? ''; 
  const valueIndex = reloadingPreferences.indexOf(value);
  invariant(valueIndex !== -1);
  await StoreService.set('reloadingPreference', value);
  const isRemovingPermission = value === 'off';
  if (isRemovingPermission) { 
    return;
  } 
  await browser.runtime.sendMessage(new ReloadInjectedButNotTrackedTabsMessage());
  location.reload();
} 

async function displayPopupToggle(popupToggle: HTMLSpanElement) {
  const extensionCommands = await browser.commands.getAll();
  const popupToggleName = '_execute_action';
  const hasCommand = extensionCommands.some((cmd) => cmd.name === popupToggleName);
  invariant(hasCommand);
  popupToggle.innerText = 
    extensionCommands.find((cmd) => cmd.name === popupToggleName)!
      .shortcut
      ?.toLocaleLowerCase() 
      ?? 'Failed to get command';
}

function getTrackedSitePatterns(trackedSitePatterns: HTMLElement): string[] {
  return Array.from(trackedSitePatterns.children).map((trackedSitePattern) => {
    const span = trackedSitePattern.firstElementChild;
    invariant(span instanceof HTMLSpanElement);
    return span.innerText;
  });
}

function getSitePatternInputFormHandler(
  sitePatternInput: HTMLInputElement, trackedSitePatternsElement: HTMLElement
) {
  return async function trackSitePattern() {
    const newPattern = sitePatternInput.value;
    invariant(newPattern.length > 0);
    // no need to do this (can pass in)
    const trackedSitePatterns = getTrackedSitePatterns(trackedSitePatternsElement);
    const matchedByNewPattern = matchedByURLPattern(newPattern);
    const newTrackedSitePatterns = trackedSitePatterns.filter(
      (trackedPattern) => !matchedByNewPattern(trackedPattern)
    );
    const isNewSitePatternTracked = newTrackedSitePatterns.some(
      (trackedPattern) => matchesURLPattern(trackedPattern)(newPattern)
    );
    if (!isNewSitePatternTracked) {
      newTrackedSitePatterns.push(newPattern);
    }
    const isChangeInTrackedSitePatterns = !isNewSitePatternTracked ||
      trackedSitePatterns.length !== newTrackedSitePatterns.length
    if (!isChangeInTrackedSitePatterns) {
      return;
    }
    try {
      const siteTrackingPermission = getSiteTrackingPermission(newTrackedSitePatterns);
      const [_, __, isPermissionGranted] = await Promise.all([
        TempStoreService.set('trackedSitePatterns', newTrackedSitePatterns),
        browser.permissions.request(siteTrackingPermission),
        browser.permissions.contains(siteTrackingPermission)
      ]); 
      // User may have granted the permission in the extension settings
      if (!isPermissionGranted) {
        throw new Error('Failed to get permission');
      }
      await Promise.all([
        TempStoreService.set('trackedSitePatterns', []),
        StoreService.set('trackedSitePatterns', newTrackedSitePatterns),
        browser.runtime.sendMessage(new InjectTrackedButNotInjectedTabsMessage())
      ]);
    } catch (error) {
      console.dir(error);
      invariant(error instanceof Error);
      sitePatternInput.setCustomValidity(error.message);
      // TODO show error, but accept input, so that opening only on sites that
      // are wanted show permission status in frontend
    }
  };
}

async function displayTrackedSitePatterns(
  trackedSitePatternsElement: HTMLElement
): Promise<void> {
  const trackedSitePatterns = await StoreService.safeGet('trackedSitePatterns');
  const trackedPatternElements = trackedSitePatterns.map(
    getTrackedSitePatternElement
  );
  trackedSitePatternsElement.append(...trackedPatternElements);
}

async function trackedSitePatternsHandler(e: PointerEvent): Promise<void> {
  if (!(e.target instanceof HTMLButtonElement)) {
    return;
  }
  const span = e.target.previousElementSibling;
  invariant(span instanceof HTMLSpanElement);
  const [trackedSitePatterns, reloadingPreference, injectedTabs] = 
    await Promise.all([
    StoreService.safeGet('trackedSitePatterns'),
    StoreService.safeGet('reloadingPreference'),
    TempStoreService.safeGet('injectedTabs')
  ]);
  invariant(trackedSitePatterns.includes(span.innerText));
  const newTrackedSitePatterns = trackedSitePatterns.filter(
    (trackedPattern) => trackedPattern !== span.innerText
  ); 
  const [_, res] = await Promise.all([
    StoreService.set('trackedSitePatterns', newTrackedSitePatterns),
    browser.permissions.remove(getSiteTrackingPermission([span.innerText]))
  ]);
  if (!res) {
    return;
  }
  console.log('removed permission for', span.innerText);
  if (reloadingPreference === 'on') {
    const removedSitePattern = new URLPattern(span.innerText);
    const injectedButNotTrackedTabs = injectedTabs.filter(([_, url]) => removedSitePattern.test(url));
    console.log('reloading injected but not tracked tabs');
    await Promise.all(injectedButNotTrackedTabs.map(([id, _]) => browser.tabs.reload(id)));
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

  const trackedSitePatternsElement = document.getElementById('trackedSitePatterns');
  invariant(trackedSitePatternsElement !== null);
  await displayTrackedSitePatterns(trackedSitePatternsElement);
  trackedSitePatternsElement.addEventListener('click', trackedSitePatternsHandler);

  const sitePatternInput = document.getElementById('sitePatternInput');
  invariant(sitePatternInput instanceof HTMLInputElement);
  const sitePatternInputForm = document.getElementById('sitePatternInputForm');
  invariant(sitePatternInputForm instanceof HTMLFormElement);
  sitePatternInputForm.addEventListener(
    'submit', 
    getSitePatternInputFormHandler(sitePatternInput, trackedSitePatternsElement)
  );
}

main().catch((e) => console.error(e));
