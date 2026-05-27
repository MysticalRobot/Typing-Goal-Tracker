import { invariant } from './utils';
import { type Message } from './types';

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
  const oneSecInMs = 1_000;
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
    console.log("recorded", timeout + drift / oneSecInMs);
    start = 0;
  };
  const saveTimeTyped = async () => {
    if (!total) {
      return
    }
    const message: Message = { action: 'saveTimeTyped', timeTypedMs: total };
    await browser.runtime.sendMessage(message);
    console.log("saved", total / oneSecInMs);
    total = 0;
  }
  return [recordKeyPress, saveTimeTyped]
}

function main() {
  const [recordKeyPress, saveTimeTyped] = getTimingCallbacks();

  document.addEventListener('keypress', recordKeyPress);

  // periodically save the time spent timing when the tab is active
  const fiveSecInMs = 5_000;
  const intervalManager = getIntervalManager(saveTimeTyped, fiveSecInMs);
  document.addEventListener('visibilitychange', intervalManager);
  intervalManager();
}

main();
