import { invariant, SaveTimeTypedMessage } from "./utils";

function getIntervalManager(callback: () => void, timeout: number) {
  let interval: number | undefined = undefined
  return () => {
    if (document.hidden) {
      clearInterval(interval);
    } else {
      interval = setInterval(callback, timeout);
    }
  };
}

const oneSecInMS = 1_000;
const timeout = 1_000;
const getTimingCallbacks = (): [() => void, () => void] => {
  let total: number = 0;
  let start: number = 0;
  const recordKeyPress = () => { 
    if (!start) {
      start = performance.now(); 
      setTimeout(recordTimeTyped, timeout);
    }
  }
  const recordTimeTyped = () => {
    invariant(start != 0);
    const end = performance.now()
    const expectedEnd = start + timeout; 
    const drift = end - expectedEnd;
    total += timeout + drift;
    console.log("recorded", timeout + drift / oneSecInMS);
    start = 0;
  };
  const saveTimeTyped = async () => {
    if (!total) {
      return
    }
    await browser.runtime.sendMessage(new SaveTimeTypedMessage(total));
    console.log("saved", total / oneSecInMS);
    total = 0;
  }
  return [recordKeyPress, saveTimeTyped]
}
const [recordKeyPress, saveTimeTyped] = getTimingCallbacks();

// "optional_host_permissions": ["<all_urls>"],

function main() {
  try {
    document.removeEventListener('keypress', recordKeyPress);
    console.debug('removed previous keypress listener');
  } catch (error) {
    console.debug('no previous keypress listener to remove');
  }
  document.addEventListener('keypress', recordKeyPress);

  // periodically save the time spent timing when the tab is active
  const fiveSecInMS = 5_000;
  const intervalManager = getIntervalManager(saveTimeTyped, fiveSecInMS);
  try {
    document.removeEventListener('visibilitychange', intervalManager);
    console.debug('removed previous visibilitychange listener');
  } catch (error) {
    console.debug('no previous visibilitychange listener to remove');
  }
  document.addEventListener('visibilitychange', intervalManager);
  intervalManager();
}

main();
