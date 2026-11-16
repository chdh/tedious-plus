/**
* General utilities for this package.
*
* @module
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

/**
* Returns the name of the data type of a value, for use in error messages.
*
* For objects, the name of the constructor is returned (e.g. "Date"), or "object" if there is none.
* For other values, the result of `typeof` is returned.
*/
export function getTypeName (value: unknown) : string {
   if (value === null) {
      return "null"; }
   if (typeof value == "object") {
      return value.constructor?.name ?? "object"; }
   return typeof value; }

const nodeInspectSymbol = Symbol.for("nodejs.util.inspect.custom");
const nodeInspectPropForBareObj = {
   value (this: object) {
      return { ...this }; },
   enumerable: false };

/**
* Creates a bare object with a `null` prototype instead of a normal `Object` prototype.
*/
export function createBareObject<T extends object = Record<string, unknown>> () : T {
   const obj = Object.create(null);
   Object.defineProperty(obj, nodeInspectSymbol, nodeInspectPropForBareObj);
      // This suppresses the "[Object: null prototype]" output e.g. with `console.log()`.
   return obj; }

/**
* Converts a normal object into a bare object.
*/
export function toBareObject<T extends object> (obj: T) : T {
   const obj2 = createBareObject<T>();
   Object.assign(obj2, obj);
   return obj2; }

/**
* Creates an UTC date value which can be used for SQL server.
*
* Note that month values are from 1 to 12 here!
*/
export function createUtcDate (year: number, month: number, day: number, hour = 0, minute = 0, second = 0) : Date {
   return new Date(Date.UTC(year, month - 1, day, hour, minute, second)); }
