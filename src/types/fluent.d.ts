/// <reference lib="dom" />

declare module "preact" {
  namespace JSX {
    interface IntrinsicElements {
      "fluent-button": Record<string, unknown>;
      "fluent-text-input": Record<string, unknown>;
      "fluent-text-field": Record<string, unknown>;
      "fluent-textarea": Record<string, unknown>;
      "fluent-dropdown": Record<string, unknown>;
      "fluent-select": Record<string, unknown>;
      "fluent-option": Record<string, unknown>;
      "fluent-card": Record<string, unknown>;
      "fluent-badge": Record<string, unknown>;
    }
  }
}
