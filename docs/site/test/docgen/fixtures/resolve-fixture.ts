export interface Target {
  readonly id: number;
}
export interface Holder<A> {
  readonly target: Target;
  readonly value: A;
}
export const use = (holder: Holder<Target>): Target => holder.target;
