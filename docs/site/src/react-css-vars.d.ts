// Allow CSS custom properties (`--foo`) in React `style={{}}` objects without a cast. React's
// CSSProperties omits them by default; this module augmentation adds the index signature so e.g.
// `style={{ "--ln-start": 931 }}` type-checks. Structural fix — no `as` at the call sites.
import "react";

declare module "react" {
  interface CSSProperties {
    [key: `--${string}`]: string | number | undefined;
  }
}
