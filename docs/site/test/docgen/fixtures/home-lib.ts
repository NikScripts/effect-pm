export interface Target {
  readonly id: number;
}
export const make = (): Target => ({ id: 1 });
