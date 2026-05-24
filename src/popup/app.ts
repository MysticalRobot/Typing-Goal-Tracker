import { invariant, getRatio, StoreService, getDailyGoalMin, matchedByURLPattern, matchesURLPattern, getTrackedSitePatternElement, notifPreferences, dailyGoalsOrder, notifPermission, TempStoreService, getSiteTrackingPermission, reloadingPreferences } from '../utils';
import { 
  type DailyGoalInputs, 
  type DailyGoals,
  type PreferenceOptions, 
  type Store,
} from '../types';

async function displayProgress(
  progressBar: HTMLProgressElement, dailyGoalsMin: DailyGoals
): Promise<void> {
  const timeTypedMS = await StoreService.get('timeTypedMS');
  const dailyGoalMin = await getDailyGoalMin(dailyGoalsMin);
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
  const value = await StoreService.get(key);
  const buttons = Array.from(form.children).filter((e) => e instanceof HTMLButtonElement);
  const hasCorrectButtons = buttons.every(
    (button, i) =>  button.getAttribute('data-value') === preferenceValues.at(i)
  );
  invariant(hasCorrectButtons);
  const correspondingButton = buttons.find(
    (button) => button.getAttribute('data-value') === value
  );
  correspondingButton!.setAttribute('data-checked', 'true');
}

function getPreferenceHandler<T extends keyof Store>(
  key: T,
  preferenceOptions: PreferenceOptions<T>,
  permission: browser.permissions.Permissions, 
  onPermissionRemoved?: () => Promise<void>,
  onPermissionGranted?: () => Promise<void>,
) {
  return async (e: PointerEvent): Promise<void> => {
    if (!(e.target instanceof HTMLButtonElement)) {
      return;
    }
    const value = e.target.getAttribute('data-value') ?? ''; 
    console.log(value);
    const valueIndex = preferenceOptions.indexOf(value);
    // This guarantees the value is of type Store[T]
    invariant(valueIndex !== -1);
    // The preference that removes a permission should be first (e.g. 'never')
    const isRemovingPermission = valueIndex === 0;
     try {
      if (isRemovingPermission) {
        console.log('removing permission');
        // Does nothing and succeeds if permission does not exist
        const permissionRemoved = await browser.permissions.remove(permission);
        if (!permissionRemoved) {
          throw new Error('Failed to remove permission');
        } else if (onPermissionRemoved !== undefined) {
          await onPermissionRemoved();
        }
      } else {
        console.log('requesting permission');
        // Does nothing and succeeds if permission is already granted
        const permissionGranted = await browser.permissions.request(permission);
        if (!permissionGranted) {
          throw new Error('Failed to get permission');
        } else if (onPermissionGranted !== undefined) {
          await onPermissionGranted();
        }
      } 
    } catch (error) {
      invariant(error instanceof Error);
      console.dir(error);
      // TODO set validity
      return;
    }
    // Extension is exited to grant permission so this only happens after 
    // permission removal or 2nd permission request 
    await StoreService.set(key, value);
  }
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
  return async function trackSitePattern(e: SubmitEvent) {
    e.preventDefault();
    const newPattern = sitePatternInput.value;
    invariant(newPattern.length > 0);
    // This needs to be pulled from 
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
      await browser.permissions.request({ origins: newTrackedSitePatterns });

      const oof = newTrackedSitePatterns.map((pattern) => new URLPattern(pattern));
      const injectedTabs = await TempStoreService.get('injectedTabs');
      const tabs = await browser.tabs.query({ url: newPattern });
      const trackedButNotInjectedTabs = tabs.filter(
        (tab) => 
        tab.id !== undefined 
        && tab.url !== undefined
        && oof.some((pattern) => pattern.test(tab.url))
        && !injectedTabs.some(([id, _]) => tab.id === id)
      ); 
      const scriptInjections = trackedButNotInjectedTabs.map(
        (tab) =>
        browser.scripting.executeScript({
          // Tabs with undefined ids are filtered out above
          target: { tabId: tab.id!, allFrames: false },
          files: ['./content-script.js'],
        })
      );
      await Promise.all(scriptInjections);
      const newInjectedTabs = injectedTabs.concat(trackedButNotInjectedTabs.map((tab) => [tab.id, tab.url]));
      console.log('injected shits into', JSON.stringify(trackedButNotInjectedTabs));
      await TempStoreService.set('injectedTabs', newInjectedTabs);

      // if (ewTrackedSitePatterns.length !== 0) {
      //   await browser.scripting.updateContentScripts(
      //     [getContentScriptRegistrationDetails(newTrackedSitePatterns)]
      //   ); 
      // } else {
      //   await browser.scripting.registerContentScripts(
      //     [getContentScriptRegistrationDetails(newTrackedSitePatterns)]
      //   ); 
      // }
      // const rcs = await browser.scripting.getRegisteredContentScripts();
      // console.dir(rcs);
      
    } catch (error) {
      console.dir(error);
      invariant(error instanceof Error);
      sitePatternInput.setCustomValidity(error.message);
      return;
      // TODO show error, but accept input, so that opening only on sites that
      // are wanted show permission status in frontend
    }
    await StoreService.set('trackedSitePatterns', newTrackedSitePatterns);
    location.reload();
  };
}

async function displayTrackedSitePatterns(
  trackedSitePatternsElement: HTMLElement
): Promise<void> {
  const trackedSitePatterns = await StoreService.get('trackedSitePatterns');
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
  const trackedSitePatterns = await StoreService.get('trackedSitePatterns');
  invariant(trackedSitePatterns.includes(span.innerText));
  const newTrackedSitePatterns = trackedSitePatterns.filter(
    (trackedPattern) => trackedPattern !== span.innerText
  ); 
  await StoreService.set('trackedSitePatterns', newTrackedSitePatterns);
  const div = e.target.parentElement;
  invariant(div instanceof HTMLDivElement);
  div.remove();
  const res = await browser.permissions.remove(getSiteTrackingPermission([span.innerText]));
  if (!res) {
    return;
  }
  await StoreService.set('trackedSitePatterns', newTrackedSitePatterns);
  console.log('removed permission for', span.innerText);
  const reloadingPreference = await StoreService.get('reloadingPreference');
  if (reloadingPreference === 'on') {
    const removedSitePattern = new URLPattern(span.innerText);
    const injectedTabs = await TempStoreService.get('injectedTabs');
    const injectedButNotTrackedTabs = injectedTabs.filter(([_, url]) => removedSitePattern.test(url));
    console.log('reloading injected but not tracked tabs');
    await Promise.all(injectedButNotTrackedTabs.map(([id, _]) => browser.tabs.reload(id)));
  }
  // No need to remove from injection flag from temp store, that is handled by bg script
}

async function main() {
  const dailyGoalsMin = await StoreService.get('dailyGoalsMin');

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
  notifPreferenceForm.addEventListener(
    'click', 
    getPreferenceHandler('notifPreference', notifPreferences, notifPermission)
  );

  const popupToggle = document.getElementById('popupToggle');
  invariant(popupToggle !== null);
  await displayPopupToggle(popupToggle);

  const editPopupToggleLink = document.getElementById('editPopupToggleLink');
  invariant(editPopupToggleLink !== null);
  editPopupToggleLink.addEventListener('click', async () => {
  // IGNORE
    browser.commands.openShortcutSettings();
  });
 
  const reloadingPreferenceForm = document.getElementById('reloadingPreferenceForm');
  invariant(reloadingPreferenceForm instanceof HTMLFormElement);
  await displayRadioButtons(
    reloadingPreferenceForm, 'reloadingPreference', reloadingPreferences
  );
  reloadingPreferenceForm.addEventListener(
    'click', 
    getPreferenceHandler('reloadingPreference', reloadingPreferences, {})
  );

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
