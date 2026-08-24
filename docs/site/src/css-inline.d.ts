/** Vite `?inline` — CSS file contents as a string (no stylesheet link). */
declare module "*.css?inline" {
  const css: string;
  export default css;
}
