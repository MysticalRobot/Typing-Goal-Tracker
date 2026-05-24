import { invariant, getRatio, StoreService, getDailyGoalMin, matchedByURLPattern, matchesURLPattern, getTrackedSitePatternElement, notifPreferences, siteTrackingPreferences, dailyGoalsOrder, notifPermission, siteTrackingPermission, TempStoreSerice } from '../utils';
import { 
  type DailyGoalInputs, type DailyGoals, type NotifPreference, 
  type PreferenceOptions, 
  type SiteTrackingPreference, 
  type Store,
  type TabInfo
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

// TODO request permission, fallback to shitty thing, add text explaining fallback
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
    const isChangeInTrackedSitePatterns = !isNewSitePatternTracked ||
      trackedSitePatterns.length !== newTrackedSitePatterns.length
    if (!isNewSitePatternTracked) {
      newTrackedSitePatterns.push(newPattern);
    }
    if (!isChangeInTrackedSitePatterns) {
      return;
    }
    try {
      // multiple shits can exist! (if in different windows)
      const oof = newTrackedSitePatterns.map((pattern) => new URLPattern(pattern));
      const injectedTabs = await TempStoreSerice.get('injectedTabs');
      const newInjectedTabs = injectedTabs.filter(
        ([_, url]) => !oof.some((pattern) => pattern.test(url))
      );
      console.dir(newInjectedTabs);
      // TODO reload if desired
      await TempStoreSerice.set('injectedTabs', newInjectedTabs);
      
    // TODO unset the preference and permission instead of TS
      // const siteTrackingPreference = await StoreService.get('siteTrackingPreference');
      // if (siteTrackingPreference === 'on' && newTrackedSitePatterns.length !== 0) {
      //   await browser.scripting.updateContentScripts(
      //     [getContentScriptRegistrationDetails(newTrackedSitePatterns)]
      //   ); 
      // } else if (siteTrackingPreference === 'on') {
      //   await browser.scripting.registerContentScripts(
      //     [getContentScriptRegistrationDetails(newTrackedSitePatterns)]
      //   ); 
      // }
      // const rcs = await browser.scripting.getRegisteredContentScripts();
      // console.dir(rcs);
      
    } catch (error) {
      console.dir(error);
      // TODO permission not granted
      invariant(error instanceof Error);
      sitePatternInput.setCustomValidity(error.message);
      return;
      // TODO show error, but accept input, so that opening only on sites that
      // are wanted 
      // show permission status in frontend
    }
    await StoreService.set('trackedSitePatterns', newTrackedSitePatterns);
    // await browser.runtime.sendMessage(new CheckForContentScriptExecutionMessage())
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
  // TODO send message to reload page if no longer tracked
  const activeTab = await browser.tabs.getCurrent();
  if (activeTab?.id !== undefined) {
    try {
      await browser.tabs.reload(activeTab.id);
    } catch (e) {
      console.dir(e);
    }
  }
}

async function main() {
  const trackedSitePatterns = (await StoreService.get('trackedSitePatterns')).map(
    (pattern) => new URLPattern(pattern)
  );
  const injectedTabs = await TempStoreSerice.get('injectedTabs');
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (
    activeTab?.id !== undefined 
  && activeTab.url !== undefined
  && trackedSitePatterns.some((pattern) => pattern.test(activeTab.url))
  && !injectedTabs.some(([id, _]) => activeTab.id === id)
  ) {
    await browser.scripting.executeScript({
      target: { tabId: activeTab.id, allFrames: false },
      files: ['./content-script.js'],
    })
    const newInjectedTabs = injectedTabs.concat([[activeTab.id, activeTab.url]]);
    await TempStoreSerice.set('injectedTabs', newInjectedTabs);
  }

  // // const activeTabs = [6];
  // console.log(JSON.stringify(activeTabs));
  // const shit = 
  //   activeTabs
  //   // doesn't have url -> doens't have activeTab permission or host permission
  //   // .filter((tab) => tab.id !== undefined && tab.url !== undefined)
  //   // TODO add filter for matching sites only
  //   .filter((tab) => tab.id !== undefined)
  //   .map((tab) => tab.id);
  // console.log(JSON.stringify(shit));
  // const promises = shit
  //   // .slice(0, 1)
  //   .map((tabId) => 
  //        browser.scripting.executeScript({
  //          target: { tabId, allFrames: true },
  //          files: ['./content-script.js'],
  //        })
  //       );
  // console.log(promises.length);
  // const results = await Promise.all(promises);
  // console.log(JSON.stringify(results));

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

  const siteTrackingPreferenceForm = document.getElementById(
    'siteTrackingPreferenceForm'
  );
  invariant(siteTrackingPreferenceForm instanceof HTMLFormElement);
  await displayRadioButtons(
    siteTrackingPreferenceForm, 'siteTrackingPreference', siteTrackingPreferences 
  );
  siteTrackingPreferenceForm.addEventListener(
    'click', 
    getPreferenceHandler(
      'siteTrackingPreference',
      siteTrackingPreferences,
      siteTrackingPermission,
      undefined,
      async () => {
        // const trackedSitePatterns = await StoreService.get('trackedSitePatterns');
        // if (trackedSitePatterns.length !== 0) {
        //   await browser.scripting.registerContentScripts(
        //     [getContentScriptRegistrationDetails(trackedSitePatterns)]
        //   ); 
        // }
      }
    )
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
