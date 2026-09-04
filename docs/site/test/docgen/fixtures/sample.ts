// A tiny self-contained module the TsProgram tests build a program over.
export interface Widget {
  readonly id: number;
}
export const makeWidget = (id: number): Widget => ({ id });
