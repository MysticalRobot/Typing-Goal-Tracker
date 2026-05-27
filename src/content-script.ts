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
  const timeoutMs = 1_000;
  let totalMs: number = 0;
  let startMs: number = 0;
  const recordKeyPress = () => { 
    if (!startMs) {
      startMs = performance.now(); 
      setTimeout(recordTimeTyped, timeoutMs);
    }
  }
  const recordTimeTyped = () => {
    invariant(startMs != 0);
    const endMs = performance.now()
    const expectedEndMs = startMs + timeoutMs; 
    const driftMs = endMs - expectedEndMs;
    totalMs += timeoutMs + driftMs;
    console.log("recorded", timeoutMs + driftMs / oneSecInMs);
    startMs = 0;
  };
  const saveTimeTyped = async () => {
    if (!totalMs) {
      return
    }
    const message: Message = { action: 'saveTimeTyped', timeTypedMs: totalMs };
    await browser.runtime.sendMessage(message);
    console.log("saved", totalMs / oneSecInMs);
    totalMs = 0;
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
