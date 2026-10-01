/**
 * Server credentials.
 *
 * The password is only persisted when the user opts in ("remember me"), and in
 * that case it goes to localStorage on the device — never to the server. Hosts
 * must not pre-fill passwords (see nix/module.nix).
 */

import { RUNTIME_CONFIG, DEFAULT_SERVER_URL } from '$lib/config';
import { SubsonicClient, normalizeServerUrl } from '$lib/api/client';
import {
  defaultStorage,
  loadPersisted,
  removePersisted,
  savePersisted,
  sessionStorageSafe,
  type StorageLike,
} from '$lib/utils/persist';

export interface Credentials {
  server: string;
  username: string;
  password: string;
}

export interface CredentialState extends Credentials {
  remembered: boolean;
}

export const CREDENTIALS_KEY = 'stave:credentials';
export const SESSION_KEY = 'stave:session';

const EMPTY: CredentialState = {
  server: normalizeServerUrl(RUNTIME_CONFIG.server ?? '') || DEFAULT_SERVER_URL,
  username: RUNTIME_CONFIG.username ?? '',
  password: '',
  remembered: false,
};

export class CredentialsStore {
  readonly state: CredentialState;

  private readonly storage: StorageLike | null;
  private readonly session: StorageLike | null;

  constructor(
    options: {
      storage?: StorageLike | null;
      session?: StorageLike | null;
      initial?: Partial<CredentialState>;
    } = {},
  ) {
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.session = options.session === undefined ? sessionStorageSafe() : options.session;

    const remembered = loadPersisted<CredentialState>(CREDENTIALS_KEY, EMPTY, {
      storage: this.storage,
    });
    const sessionOnly = loadPersisted<CredentialState>(
      SESSION_KEY,
      { ...EMPTY, password: '' },
      {
        storage: this.session,
      },
    );

    const base = remembered.password ? remembered : { ...sessionOnly, remembered: false };
    this.state = $state<CredentialState>({ ...EMPTY, ...base, ...options.initial });
  }

  get isComplete(): boolean {
    return Boolean(this.state.server && this.state.username && this.state.password);
  }

  /** A client for the current credentials, or null when they are incomplete. */
  client(): SubsonicClient | null {
    if (!this.isComplete) return null;
    return new SubsonicClient({
      server: this.state.server,
      username: this.state.username,
      password: this.state.password,
    });
  }

  save(credentials: Credentials, remember: boolean): void {
    this.state.server = normalizeServerUrl(credentials.server) || DEFAULT_SERVER_URL;
    this.state.username = credentials.username.trim();
    this.state.password = credentials.password;
    this.state.remembered = remember;

    if (remember) {
      savePersisted(CREDENTIALS_KEY, this.state, { storage: this.storage });
      removePersisted(SESSION_KEY, this.session);
    } else {
      // Session-only: cleared when the tab/app closes.
      savePersisted(
        SESSION_KEY,
        { ...this.state, password: this.state.password },
        { storage: this.session },
      );
      removePersisted(CREDENTIALS_KEY, this.storage);
    }
  }

  clear(): void {
    this.state.server = EMPTY.server;
    this.state.username = '';
    this.state.password = '';
    this.state.remembered = false;
    removePersisted(CREDENTIALS_KEY, this.storage);
    removePersisted(SESSION_KEY, this.session);
  }
}
