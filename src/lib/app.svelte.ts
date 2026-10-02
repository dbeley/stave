/**
 * Composition root.
 *
 * Every store is constructed here and wired together explicitly. Components
 * import the `app` singleton and read from it; nothing reaches for a global
 * hidden inside a store, which keeps the dependency graph visible (and makes
 * tests able to build a fully-faked app).
 */

import { SubsonicClient, type Credentials as ApiCredentials } from '$lib/api/client';
import { describeError, isAuthError } from '$lib/api/errors';
import type { Album } from '$lib/domain/types';
import { createGlobalBindings, createPercentSeekBindings } from '$lib/keyboard/globalBindings';
import type { Binding, Scope } from '$lib/keyboard/registry.svelte';
import { KeyboardRouter } from '$lib/keyboard/registry.svelte';
import { createBlobStore, isNativePlatform } from '$lib/offline/platform';
import { IndexedDbOfflineDatabase } from '$lib/offline/db';
import { DownloadManager } from '$lib/offline/downloads.svelte';
import { OfflineResolver } from '$lib/offline/resolve';
import type { BlobStore } from '$lib/offline/blobStore';
import { PlayerStore, type AudioPort } from '$lib/player/player.svelte';
import { BrowserMediaSession, type MediaSessionPort } from '$lib/player/mediaSession';
import { CapabilityStore } from '$lib/stores/capability.svelte';
import { CredentialsStore } from '$lib/stores/credentials.svelte';
import { FavoritesStore } from '$lib/stores/favorites.svelte';
import { LibraryStore } from '$lib/stores/library.svelte';
import { ListenLaterStore } from '$lib/stores/listenLater.svelte';
import { QueueStore } from '$lib/stores/queue.svelte';
import { RouterStore } from '$lib/stores/router.svelte';
import { SearchStore } from '$lib/stores/search.svelte';
import { SettingsStore } from '$lib/stores/settings.svelte';
import { ToastStore } from '$lib/stores/toast.svelte';
import { UiStore } from '$lib/stores/ui.svelte';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ConnectionState {
  status: ConnectionStatus;
  error: string | undefined;
  serverVersion: string | undefined;
  openSubsonic: boolean;
}

export interface AppOptions {
  /** Force the native blob store (tests / Capacitor). */
  native?: boolean;
  /** Inject a fake audio element (tests). */
  createAudio?: () => AudioPort;
  /** Inject a MediaSession (tests). */
  mediaSession?: MediaSessionPort;
  /** Start with these bindings registered. */
  bindings?: Binding[];
}

export class App {
  private client: SubsonicClient | null = null;

  readonly settings = new SettingsStore();
  readonly capability = new CapabilityStore();
  readonly credentials = new CredentialsStore();
  readonly toasts = new ToastStore();
  readonly queue = new QueueStore();
  readonly ui = new UiStore();
  readonly router = new RouterStore();

  readonly db = new IndexedDbOfflineDatabase();
  readonly blobs: BlobStore;
  readonly resolver: OfflineResolver;
  readonly downloads: DownloadManager;

  readonly library: LibraryStore;
  readonly favorites: FavoritesStore;
  readonly listenLater: ListenLaterStore;
  readonly search: SearchStore;
  readonly player: PlayerStore;

  readonly keyboard: KeyboardRouter;
  readonly connection: ConnectionState;

  /** Bumped to ask the search page to focus its input. */
  readonly focusRequests: { search: number };

  private teardownRouter: (() => void) | null = null;

  constructor(private readonly options: AppOptions = {}) {
    const native = options.native ?? isNativePlatform();

    this.blobs = createBlobStore(this.db, { native });

    this.resolver = new OfflineResolver({
      listCachedIds: () => this.db.listAllTrackIds(),
      getBlob: (id) => this.blobs.get(id),
      streamUrl: (id) => {
        const client = this.client;
        if (!client) return '';
        return client.streamUrl(id, { maxBitRate: this.settings.state.streamMaxBitRate });
      },
    });

    this.downloads = new DownloadManager({
      db: this.db,
      blobs: this.blobs,
      fetchAudio: async (track) => {
        const client = this.requireClient();
        const response = await fetch(client.downloadUrl(track.id));
        if (!response.ok) throw new Error(`download failed (HTTP ${response.status})`);
        return response.blob();
      },
      loadAlbum: (albumId) => this.requireClient().getAlbum(albumId),
      onTrackCached: (track) => this.resolver.markCached(track.id),
      onTrackRemoved: (trackId) => this.resolver.markRemoved(trackId),
    });

    this.library = new LibraryStore({
      client: () => this.client,
      onError: (message) => this.toasts.error(message),
      pageSize: () => this.settings.state.pageSize,
    });

    this.favorites = new FavoritesStore({
      client: () => this.client,
      onError: (message) => this.toasts.error(message),
    });

    this.listenLater = new ListenLaterStore({
      sync: (entries, changes) => this.syncOfflineCache(entries, changes),
    });

    this.search = new SearchStore({
      client: () => this.client,
      onError: (message) => this.toasts.error(message),
    });

    this.player = new PlayerStore({
      queue: this.queue,
      settings: this.settings,
      toasts: this.toasts,
      client: () => this.client,
      resolveUrl: async (track) => {
        if (!this.client) throw new Error('not connected to a server');
        await this.resolver.prime();
        const resolved = await this.resolver.resolve(track.id);
        return { url: resolved.url, source: resolved.source };
      },
      ...(options.createAudio ? { createAudio: options.createAudio } : {}),
      // A real MediaSession by default. This was the whole bug: the port was only
      // ever passed in by tests, so production fell back to the no-op and the OS
      // media controls never appeared at all — the class was written, tested and
      // dead. Tests still inject their own.
      mediaSession: options.mediaSession ?? new BrowserMediaSession(),
    });

    this.connection = $state<ConnectionState>({
      status: this.credentials.isComplete ? 'connecting' : 'disconnected',
      error: undefined,
      serverVersion: undefined,
      openSubsonic: false,
    });

    this.focusRequests = $state<{ search: number }>({ search: 0 });

    this.keyboard = new KeyboardRouter({
      activeScopes: () => this.activeScopes(),
    });

    const globalBindings = [...createGlobalBindings(this), ...createPercentSeekBindings(this)];
    if (options.bindings) globalBindings.push(...options.bindings);
    this.keyboard.registerAll(globalBindings);

    // Restore the queue's contents from the previous session.
    this.queue.restore(this.queue.snapshot());
  }

  // ------------------------------------------------------------- connection

  getClient(): SubsonicClient | null {
    return this.client;
  }

  requireClient(): SubsonicClient {
    if (!this.client) throw new Error('not connected to a server');
    return this.client;
  }

  get isConnected(): boolean {
    return this.client !== null && this.connection.status === 'connected';
  }

  /** Validate credentials against the server, then adopt them. */
  async connect(
    credentials: ApiCredentials,
    options: { remember?: boolean } = {},
  ): Promise<boolean> {
    const client = new SubsonicClient(credentials);
    this.connection.status = 'connecting';
    this.connection.error = undefined;

    try {
      const info = await client.ping();
      this.client = client;
      this.connection.status = 'connected';
      this.connection.serverVersion = info.serverVersion ?? info.version;
      this.connection.openSubsonic = info.openSubsonic;
      this.credentials.save(credentials, options.remember ?? false);
      this.toasts.ok(`connected to ${client.server}`);
      await this.onConnected();
      return true;
    } catch (error) {
      this.client = null;
      this.connection.status = 'error';
      this.connection.error = describeError(error);
      this.toasts.error(
        isAuthError(error)
          ? 'wrong username or password'
          : `cannot connect: ${this.connection.error}`,
      );
      return false;
    }
  }

  /** Adopt already-stored credentials (app start-up). */
  async reconnect(): Promise<boolean> {
    const client = this.credentials.client();
    if (!client) {
      this.connection.status = 'disconnected';
      return false;
    }
    this.client = client;
    try {
      const info = await client.ping();
      this.connection.status = 'connected';
      this.connection.serverVersion = info.serverVersion ?? info.version;
      this.connection.openSubsonic = info.openSubsonic;
      await this.onConnected();
      return true;
    } catch (error) {
      this.connection.status = 'error';
      this.connection.error = describeError(error);
      return false;
    }
  }

  disconnect(): void {
    this.client = null;
    this.connection.status = 'disconnected';
    this.connection.serverVersion = undefined;
    this.credentials.clear();
    this.favorites.clear();
    this.search.clear();
    this.resolver.reset();
    this.queue.clear();
    this.player.stop();
  }

  /** Load whatever the current page needs right after connecting. */
  private async onConnected(): Promise<void> {
    void this.downloads.hydrate();
    await this.resolver.prime();
    if (this.settings.state.offlineCacheEnabled) {
      this.syncOfflineCache(this.listenLater.state.entries, {
        added: this.listenLater.albums,
        removed: [],
      });
    }
    // The shell — and whatever page it is showing — mounts *before* the first
    // successful connection, so its initial load ran with no client at all.
    // Refresh the current view now that there is one, or the user is left
    // staring at "not connected" panes.
    await this.refreshCurrentView({ silent: true });
  }

  /** Called once from main.ts to start listening for route changes. */
  start(): void {
    this.teardownRouter = this.router.start();
    void this.reconnect();
  }

  stop(): void {
    this.teardownRouter?.();
    this.teardownRouter = null;
  }

  // -------------------------------------------------------------- keyboard

  /**
   * Scope precedence: overlay > queue window > global, or page > global.
   *
   * An open overlay is modal: the page underneath keeps rendering but stops
   * receiving keys, so an album-page `A` cannot fire while the queue window is
   * up. Global bindings stay live so transport and closing the overlay still
   * work.
   */
  private activeScopes(): Scope[] {
    if (this.ui.state.overlay) {
      const scopes: Scope[] = ['overlay'];
      if (this.ui.state.overlay === 'queue') scopes.push('queue');
      scopes.push('global');
      return scopes;
    }
    return ['page', 'global'];
  }

  /** Route a raw keyboard event through the registry. */
  handleKeydown(event: KeyboardEvent): boolean {
    return this.keyboard.handle(event, { editable: isEditable(event) });
  }

  /**
   * Android hardware back button (and any other "go back" affordance).
   *
   * An open overlay is modal, so it is closed first. Otherwise walk the
   * in-app route history. Returns `false` when there is nothing left to do,
   * which tells the caller (the native plugin) to let the OS exit the app.
   */
  handleBack(): boolean {
    if (this.ui.anyOverlayOpen) {
      this.ui.closeOverlay();
      return true;
    }
    return this.router.back();
  }

  // -------------------------------------------------------------- commands

  /** Request the search input to take focus (the `/` shortcut). */
  focusSearch(): void {
    this.focusRequests.search += 1;
  }

  /** Re-fetch whatever the current route shows. */
  async refreshCurrentView(options: { silent?: boolean } = {}): Promise<void> {
    const route = this.router.current;
    switch (route.name) {
      case 'home':
        // The home page shows two panes, so both lists are refreshed.
        await Promise.all([
          this.library.loadAlbumList('random', { refresh: true }),
          this.library.loadAlbumList('newest', { refresh: true }),
        ]);
        break;
      case 'albums':
        await this.library.loadAlbumList(route.sort, { refresh: true });
        break;
      case 'artists':
        await this.library.loadArtistsList({ refresh: true });
        break;
      case 'album':
        await this.library.loadAlbum(route.id, { refresh: true });
        break;
      case 'artist':
        await this.library.loadArtist(route.id, { refresh: true });
        break;
      case 'favorites':
        await this.favorites.load({ refresh: true });
        break;
      default:
        break;
    }
    if (!options.silent) this.toasts.info('reloaded');
  }

  /** Toggle offline caching; enabling it starts fetching listen-later albums. */
  setOfflineCacheEnabled(enabled: boolean): void {
    this.settings.update({ offlineCacheEnabled: enabled });
    if (enabled) {
      this.syncOfflineCache(this.listenLater.state.entries, {
        added: this.listenLater.albums,
        removed: [],
      });
      this.toasts.info('offline cache on — downloading listen later albums');
      return;
    }
    this.toasts.info('offline cache off — downloads paused (cached files kept)');
  }

  /** Keep the offline cache in step with the listen-later list. */
  private syncOfflineCache(
    _entries: { album: Album }[],
    changes: { added: Album[]; removed: string[] },
  ): void {
    if (!this.settings.state.offlineCacheEnabled) return;
    for (const album of changes.added) this.downloads.enqueue(album);
    for (const albumId of changes.removed) void this.downloads.remove(albumId);
  }

  /** Free everything held by the offline cache. */
  async clearOfflineCache(): Promise<void> {
    await this.downloads.clearAll();
    this.resolver.reset();
    this.toasts.ok('offline cache cleared');
  }
}

function isEditable(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** Singleton used by the UI. Tests build their own `new App({...})`. */
export const app = new App();
