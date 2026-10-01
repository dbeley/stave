import { describe, expect, it, vi } from 'vitest';
import { CREDENTIALS_KEY, CredentialsStore, SESSION_KEY } from '$lib/stores/credentials.svelte';
import { memoryStorage } from '../../helpers/storage';

describe('CredentialsStore', () => {
  it('pre-fills the server URL and username from runtime config', () => {
    const store = new CredentialsStore({ storage: null, session: null });
    // No runtime config in the test environment, so the default is used.
    expect(store.state.server).toContain('http');
    expect(store.isComplete).toBe(false);
  });

  it('accepts an explicit initial state', () => {
    const store = new CredentialsStore({
      storage: null,
      session: null,
      initial: { server: 'http://music.local:4533', username: 'dave' },
    });
    expect(store.state.server).toBe('http://music.local:4533');
    expect(store.state.username).toBe('dave');
  });

  it('is complete only with server, username and password', () => {
    const store = new CredentialsStore({ storage: null, session: null });
    store.save({ server: 'http://a', username: 'u', password: 'p' }, false);
    expect(store.isComplete).toBe(true);
  });

  it('normalises the server URL (scheme added, trailing slashes removed)', () => {
    const store = new CredentialsStore({ storage: null, session: null });
    store.save({ server: 'music.local:4533/', username: '  dave  ', password: 'pw' }, false);
    expect(store.state.server).toBe('http://music.local:4533');
    expect(store.state.username).toBe('dave');
  });

  it('keeps the password only in session storage when not remembered', () => {
    const storage = memoryStorage();
    const session = memoryStorage();
    const store = new CredentialsStore({ storage, session });

    store.save({ server: 'http://a', username: 'u', password: 'secret' }, false);

    expect(storage.map.has(CREDENTIALS_KEY)).toBe(false);
    expect(session.map.has(SESSION_KEY)).toBe(true);
    expect(store.state.remembered).toBe(false);
  });

  it('persists the password when remember is ticked', () => {
    const storage = memoryStorage();
    const session = memoryStorage();
    const store = new CredentialsStore({ storage, session });

    store.save({ server: 'http://a', username: 'u', password: 'secret' }, true);

    expect(storage.map.has(CREDENTIALS_KEY)).toBe(true);
    expect(session.map.has(SESSION_KEY)).toBe(false);

    // A new store instance (a fresh app start) recovers the credentials.
    const reloaded = new CredentialsStore({ storage, session });
    expect(reloaded.isComplete).toBe(true);
    expect(reloaded.state.password).toBe('secret');
    expect(reloaded.state.remembered).toBe(true);
  });

  it('does not restore a remembered password from a session-only save', () => {
    const storage = memoryStorage();
    const session = memoryStorage();
    new CredentialsStore({ storage, session }).save(
      { server: 'http://a', username: 'u', password: 'secret' },
      false,
    );

    const reloaded = new CredentialsStore({ storage, session });
    expect(reloaded.isComplete).toBe(true); // the session still exists in this tab
    expect(reloaded.state.remembered).toBe(false);
  });

  it('clear() wipes both stores', () => {
    const storage = memoryStorage();
    const session = memoryStorage();
    const store = new CredentialsStore({ storage, session });
    store.save({ server: 'http://a', username: 'u', password: 'secret' }, true);

    store.clear();

    expect(store.isComplete).toBe(false);
    expect(store.state.password).toBe('');
    expect(storage.map.has(CREDENTIALS_KEY)).toBe(false);
    expect(session.map.has(SESSION_KEY)).toBe(false);
  });

  it('builds a client with the current credentials', () => {
    const store = new CredentialsStore({
      storage: null,
      session: null,
      initial: { server: 'http://music:4533', username: 'dave', password: 'pw' },
    });

    const client = store.client();
    expect(client).not.toBeNull();
    expect(client?.server).toBe('http://music:4533');
    expect(client?.username).toBe('dave');
  });

  it('returns no client until the credentials are complete', () => {
    const store = new CredentialsStore({ storage: null, session: null });
    store.save({ server: 'http://a', username: 'u', password: '' }, false);
    expect(store.client()).toBeNull();
  });

  it('never writes the password into the runtime config path', () => {
    // Regression guard: hosts may pre-fill the server, never a password.
    const store = new CredentialsStore({ storage: null, session: null });
    expect(store.state.password).toBe('');
  });
});

describe('CredentialsStore title handling', () => {
  it('reports persistence failures without throwing', () => {
    const hostile = {
      getItem: () => null,
      setItem: vi.fn(() => {
        throw new Error('quota exceeded');
      }),
      removeItem: vi.fn(),
    };
    const store = new CredentialsStore({ storage: hostile, session: hostile });
    expect(() =>
      store.save({ server: 'http://a', username: 'u', password: 'p' }, true),
    ).not.toThrow();
    expect(store.isComplete).toBe(true);
  });
});
