import { invariant, getRatio, StoreService, getDailyGoalMin } from '../utils';
import { 
  type DailyGoalInputs, type DailyGoals, type NotifFrequency 
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
    const dailyGoalsMin = dailyGoalInputs.map((input) => parseInt(input.value));
    const hasNumericGoalValues = dailyGoalsMin.every((goal) => !Number.isNaN(goal));
    invariant(hasNumericGoalValues);
    await StoreService.set("dailyGoalsMin", dailyGoalsMin as DailyGoals);
  }
}

async function displayPopupToggle(popupToggle: HTMLSpanElement) {
  const extensionCommands = await browser.commands.getAll();
  const popupToggleName = '_execute_action';
  const hasCommand = extensionCommands.some((cmd) => cmd.name === popupToggleName);
  invariant(hasCommand);
  popupToggle.innerText = 
    extensionCommands.find((command) => command.name === popupToggleName)!
      .shortcut
      ?.toLocaleLowerCase() 
      ?? 'Failed to get command';
}

async function displayNotifFrequency(notifFrequencyButtons: Element): Promise<void> {
  const notifFrequency = await StoreService.get('notifFrequency');
  const buttons = Array.from(notifFrequencyButtons.children);
  const hasCorrespondingButton = buttons.some(
    (button) => button.id === notifFrequency
  );
  invariant(hasCorrespondingButton);
  const notifFrequencyButton = buttons.find(
    (button) => button.id === notifFrequency
  );
  notifFrequencyButton!.setAttribute('data-checked', 'true');
}

async function saveNotifFrequency(e: PointerEvent): Promise<void> {
  if (!(e.target instanceof Element) || !e.target.matches('button')) {
    return;
  }
  invariant(StoreService.notifFrequencies.includes(e.target.id as NotifFrequency));
  await StoreService.set("notifFrequency", e.target.id as NotifFrequency);
}


async function main() {
  const dailyGoalsMin = await StoreService.get('dailyGoalsMin');

  const progressBar = document.getElementById('progressBar');
  invariant(progressBar !== null && progressBar instanceof HTMLProgressElement);
  await displayProgress(progressBar, dailyGoalsMin);
 
  const dailyGoalInputs = Array.from(
    document.getElementsByClassName('dailyGoalInput')
  );
  const areInputs = dailyGoalInputs.every((el) => el instanceof HTMLInputElement);
  const hasInputForEachDayInOrder = StoreService.dailyGoalsOrder.every(
    (day, i) => day === dailyGoalInputs.at(i)?.id
  );
  invariant(areInputs && hasInputForEachDayInOrder);
  await displayDailyGoals(dailyGoalInputs as DailyGoalInputs, dailyGoalsMin);

  const dailyGoalsForm = document.getElementById('dailyGoalsForm');
  invariant(dailyGoalsForm !== null && dailyGoalsForm instanceof HTMLFormElement);
  dailyGoalsForm.addEventListener(
    'submit', getDailyGoalsFormHandler(dailyGoalInputs as DailyGoalInputs)
  );

  const popupToggle = document.getElementById('popupToggle');
  invariant(popupToggle !== null);
  await displayPopupToggle(popupToggle);

  const notifFrequencyButtons = document.getElementById('notifFrequencyButtons');
  invariant(
    notifFrequencyButtons !== null 
    && notifFrequencyButtons.childElementCount === StoreService.notifFrequencies.length
  );
  await displayNotifFrequency(notifFrequencyButtons);
  notifFrequencyButtons.addEventListener('click', saveNotifFrequency);

  const editPopupToggleLink = document.getElementById('editPopupToggleLink');
  invariant(editPopupToggleLink !== null);
  editPopupToggleLink.addEventListener('click', async () => {
    browser.commands.openShortcutSettings();
  });
}

main().catch((e) => console.error(e));
