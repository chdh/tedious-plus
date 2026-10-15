import {after} from "node:test";

const timeoutMs = 10000;

function terminateProcess() {
   const resources = process.getActiveResourcesInfo();
   console.error(
      `Process did not exit within ${timeoutMs} ms after the tests finished.\n` +
      `Active resources: ${resources.join(", ") || "(none reported)"}`);
   process.exit(99); }

function startWatchdog() {
   const timer = setTimeout(terminateProcess, timeoutMs);
   timer.unref(); }

after(startWatchdog);
