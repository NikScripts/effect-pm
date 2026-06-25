/**
 * @module web/primitives
 *
 * The look: shadcn-style building blocks on the dashboard theme (`theme.css`). Pure
 * Tailwind utility classes + a tiny `cn` — no component library, no clsx/cva. Bring
 * Tailwind and import `@nikscripts/effect-pm/web/theme.css` (or your own vars).
 *
 * @since 1.0.0
 */
import * as React from "react";
import { cn } from "./cn";

/** A bordered card surface. @since 1.0.0 */
export const Card = (props: {
  readonly children: React.ReactNode;
  readonly className?: string;
}): React.ReactElement => (
  <div className={cn("rounded-xl border bg-card text-card-foreground", props.className)}>
    {props.children}
  </div>
);

/** Card inner padding. @since 1.0.0 */
export const CardBody = (props: {
  readonly children: React.ReactNode;
  readonly className?: string;
}): React.ReactElement => <div className={cn("p-3", props.className)}>{props.children}</div>;

const TONES = {
  green: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  yellow: "text-amber-400 bg-amber-500/10 border-amber-500/30",
  red: "text-rose-400 bg-rose-500/10 border-rose-500/30",
  blue: "text-sky-400 bg-sky-500/10 border-sky-500/30",
  gray: "text-muted-foreground bg-muted border-border",
} as const;
const FILLS = {
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-rose-500",
  blue: "bg-sky-500",
  gray: "bg-neutral-500",
} as const;
/** Semantic tone of a {@link Badge} / {@link Button} / {@link Bar}. @since 1.0.0 */
export type Tone = keyof typeof TONES;

/** A status pill. @since 1.0.0 */
export const Badge = (props: {
  readonly children: React.ReactNode;
  readonly tone?: Tone;
}): React.ReactElement => (
  <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", TONES[props.tone ?? "gray"])}>
    {props.children}
  </span>
);

/** An action button; `tone="red"` reads as destructive. @since 1.0.0 */
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
    className={cn(
      "inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-medium transition-colors hover:brightness-125 disabled:opacity-40",
      TONES[props.tone ?? "blue"],
    )}
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
    <span className="text-muted-foreground">{props.label}</span>
    <span className="font-medium tabular-nums">{props.children}</span>
  </div>
);

/** A horizontal proportion bar (0..1). @since 1.0.0 */
export const Bar = (props: { readonly value: number; readonly tone?: Tone }): React.ReactElement => (
  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
    <div
      className={cn("h-full rounded-full transition-all", FILLS[props.tone ?? "blue"])}
      style={{ width: `${Math.max(0, Math.min(1, props.value)) * 100}%` }}
    />
  </div>
);

/** A small uppercase section label. @since 1.0.0 */
export const SectionLabel = (props: { readonly children: React.ReactNode }): React.ReactElement => (
  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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
