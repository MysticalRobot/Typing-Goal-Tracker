import { invariant, SaveTimeTypedMessage } from "./utils";

function getIntervalManager(callback: () => void, timeout: number): () => void {
  let interval: number | undefined = undefined
  return () => {
    if (document.hidden) {
      clearInterval(interval);
    } else {
      interval = setInterval(callback, timeout);
    }
  };
}

function getTimingCallbacks(): [() => void, () => void] {
  const oneSecInMS = 1_000;
  const timeout = 1_000;
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

function main() {
  const [recordKeyPress, saveTimeTyped] = getTimingCallbacks();

  document.addEventListener('keypress', recordKeyPress);

  // periodically save the time spent timing when the tab is active
  const fiveSecInMS = 5_000;
  const intervalManager = getIntervalManager(saveTimeTyped, fiveSecInMS);
  document.addEventListener('visibilitychange', intervalManager);
  intervalManager();
}

main();
