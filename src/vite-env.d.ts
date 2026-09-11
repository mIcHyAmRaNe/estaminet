/// <reference types="vite/client" />

// Fluent UI Web Components — canonical fluent IntrinsicElements live in
// src/jsx-fix.d.ts (preact/jsx-runtime namespace, the active JSX checker).
// Side-effect module declaration for Fluent bundle
declare module "@fluentui/web-components/web-components.js" {
  const _: unknown;
  export default _;
}
