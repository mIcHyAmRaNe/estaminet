/// <reference types="vite/client" />

// Fluent UI Web Components — allow JSX tags without breaking Preact types
declare global {
  namespace JSX {
    interface IntrinsicElements {
      "fluent-button": any;
      "fluent-text-input": any;
      "fluent-text-field": any;
      "fluent-textarea": any;
      "fluent-dropdown": any;
      "fluent-select": any;
      "fluent-option": any;
      "fluent-card": any;
      "fluent-badge": any;
    }
  }
}
// Side-effect module declaration for Fluent bundle
declare module "@fluentui/web-components/web-components.js" {
  const _: unknown;
  export default _;
}
