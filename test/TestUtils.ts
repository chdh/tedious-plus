export type TypeEqual<X, Y> =
   (<T>() => T extends X ? 1 : 2) extends
   (<T>() => T extends Y ? 1 : 2) ? true : false;

export function assertType<_T extends true>() : void {}
