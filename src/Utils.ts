/**
* Utility functions for this package.
*
* @internal @module
*/

/**
* Throws an exception if the passed condition is not `true`.
*
* This is a TypeScript assertion function. After a call, the compiler narrows `cond` to `true`.
*
* @param cond
*    The condition to be checked.
* @param msg
*    An optional message for the exception.
* @throws Error
*    If `cond` is not `true`.
*/
export function assert (cond: boolean, msg?: string) : asserts cond {
   if (!cond) {
      throw new Error(msg ?? "Assertion failed."); }}

/**
* Returns a promise that is resolved after the specified time.
*
* @param ms
*    The delay time in milliseconds.
*/
export function sleep (ms: number) : Promise<void> {
   const promise: PromiseWithResolvers<void> = Promise.withResolvers();
   setTimeout(promise.resolve, ms);
   return promise.promise; }

/**
* Waits until a promise is settled, but at most for the specified time.
*
* @param promise
*    The promise to wait for. Its result value or rejection reason is ignored.
* @param ms
*    The maximum time to wait, in milliseconds.
* @returns
*    `true` if the promise has been settled, `false` if the timeout has elapsed.
*/
export function waitWithTimeout (promise: Promise<unknown>, ms: number) : Promise<boolean> {
   const result: PromiseWithResolvers<boolean> = Promise.withResolvers();
   const timer = setTimeout(timeoutHandler, ms);
   promise.then(settledHandler, settledHandler);
   return result.promise;
   function timeoutHandler() {
      result.resolve(false); }
   function settledHandler() {
      clearTimeout(timer);
      result.resolve(true); }}
