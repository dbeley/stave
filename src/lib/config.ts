/**
 * Application-wide constants.
 *
 * Runtime configuration (`window.__STAVE_CONFIG__`) is injected by the
 * host at deploy time and may only carry *public* values — a server URL and a
 * username to pre-fill. Credentials entered by the user stay on the client.
 */

export interface RuntimeConfig {
  server?: string;
  username?: string;
  instanceName?: string;
}

const runtime: RuntimeConfig =
  (typeof globalThis !== 'undefined'
    ? (globalThis as unknown as { __STAVE_CONFIG__?: RuntimeConfig }).__STAVE_CONFIG__
    : undefined) ?? {};

export const RUNTIME_CONFIG: RuntimeConfig = runtime;

/** Identifies this client to the server (`c=` parameter). */
export const CLIENT_NAME = 'stave';

/** Subsonic API version we target. */
export const API_VERSION = '1.16.1';

export const DEFAULT_APP_NAME = 'stave';

/** Shown in the header; overridable by the host via runtime config. */
export const APP_NAME = RUNTIME_CONFIG.instanceName?.trim() || DEFAULT_APP_NAME;

export const APP_VERSION = __APP_VERSION__;

/** How many items a list page fetches per page. */
export const PAGE_SIZE = 50;

/** Cover art sizes requested from the server. */
export const COVER_SIZE = {
  thumb: 120,
  list: 240,
  detail: 600,
} as const;

export const DEFAULT_SERVER_URL = 'http://localhost:4533';
