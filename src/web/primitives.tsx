/**
 * @module web/primitives
 *
 * Small unstyled-ish building blocks (Tailwind utility classes; bring your own
 * Tailwind). Kept dependency-free so the shipped widgets don't drag in a component
 * library — swap them by composing the exported widgets if you want your own look.
 *
 * @since 1.0.0
 */
import * as React from "react";

/** A bordered surface. @since 1.0.0 */
export const Card = (props: {
  readonly children: React.ReactNode;
  readonly className?: string;
}): React.ReactElement => (
  <div className={`rounded-xl border border-neutral-800 bg-neutral-900 p-3 ${props.className ?? ""}`}>
    {props.children}
  </div>
);

const TONES = {
  green: "bg-green-500/15 text-green-400 border-green-500/30",
  yellow: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  red: "bg-red-500/15 text-red-400 border-red-500/30",
  blue: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  gray: "bg-neutral-500/15 text-neutral-400 border-neutral-500/30",
} as const;
/** Tone of a {@link Badge}. @since 1.0.0 */
export type Tone = keyof typeof TONES;

/** A small status pill. @since 1.0.0 */
export const Badge = (props: {
  readonly children: React.ReactNode;
  readonly tone?: Tone;
}): React.ReactElement => (
  <span className={`inline-block rounded-md border px-1.5 py-0.5 text-xs font-medium ${TONES[props.tone ?? "gray"]}`}>
    {props.children}
  </span>
);

/** An action button; `tone="red"` for destructive. @since 1.0.0 */
export const Button = (props: {
  readonly children: React.ReactNode;
  readonly onClick: () => void;
  readonly tone?: Tone;
  readonly disabled?: boolean;
}): React.ReactElement => (
  <button
    type="button"
    disabled={props.disabled ?? false}
    onClick={props.onClick}
    className={`rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-40 ${TONES[props.tone ?? "gray"]}`}
  >
    {props.children}
  </button>
);

/** A label / value row. @since 1.0.0 */
export const Field = (props: {
  readonly label: string;
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <div className="flex items-baseline justify-between gap-2 text-sm">
    <span className="text-neutral-500">{props.label}</span>
    <span className="font-medium text-neutral-200">{props.children}</span>
  </div>
);

/** A horizontal proportion bar (0..1). @since 1.0.0 */
export const Bar = (props: {
  readonly value: number;
  readonly tone?: Tone;
}): React.ReactElement => (
  <div className="h-1.5 w-full overflow-hidden rounded bg-neutral-800">
    <div
      className={`h-full ${TONES[props.tone ?? "blue"]}`}
      style={{ width: `${Math.max(0, Math.min(1, props.value)) * 100}%` }}
    />
  </div>
);

/** A titled section header. @since 1.0.0 */
export const SectionLabel = (props: { readonly children: React.ReactNode }): React.ReactElement => (
  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
    {props.children}
  </div>
);

/** A button that asks for confirmation before firing (destructive actions). @since 1.0.0 */
export const ConfirmButton = (props: {
  readonly children: React.ReactNode;
  readonly onConfirm: () => void;
  readonly tone?: Tone;
}): React.ReactElement => {
  const [armed, setArmed] = React.useState(false);
  if (armed) {
    return (
      <span className="inline-flex items-center gap-1">
        <Button tone="red" onClick={() => { setArmed(false); props.onConfirm(); }}>confirm</Button>
        <Button tone="gray" onClick={() => setArmed(false)}>cancel</Button>
      </span>
    );
  }
  return <Button tone={props.tone ?? "red"} onClick={() => setArmed(true)}>{props.children}</Button>;
};
