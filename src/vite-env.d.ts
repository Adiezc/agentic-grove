/// <reference types="vite/client" />

/**
 * The environment variables this project reads at build time.
 *
 * Declared rather than reached for untyped, so a typo in one is a compile error instead of a
 * silent `undefined` that quietly falls through to a default.
 */
interface ImportMetaEnv {
  /** Which quality preset the grove starts at: 'high' (default), 'balanced' or 'low'. */
  readonly VITE_GROVE_QUALITY?: string
  /** When set, save a still of the window once the scene has settled. Development only. */
  readonly VITE_GROVE_CAPTURE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
