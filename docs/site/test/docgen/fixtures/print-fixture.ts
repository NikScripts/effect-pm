export interface Target {
  readonly id: number;
}
export interface Holder<A> {
  readonly value: A;
}
export const use = (holder: Holder<Target>): Target => holder.value;
export const pick = (flag: boolean): Target | undefined => (flag ? { id: 1 } : undefined);
export const remap = <T>(value: T): { [K in keyof T]: T[K] } => value;
export const identity = <A>(value: A): A => value;
export const targets = (): ReadonlyArray<Target> => [];
