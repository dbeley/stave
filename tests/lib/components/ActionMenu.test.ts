import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Album, Track } from '$lib/domain/types';
import { KeyboardRouter } from '$lib/keyboard/registry.svelte';

/**
 * The action menu reads its target from the UI store and registers its keys on
 * the app's keyboard router. Tests fake the app store-by-store but use the real
 * `KeyboardRouter`, so "which binding fires" and "does unmount clean up" are
 * exercised for real rather than against a mock that cannot get either wrong.
 */
const h = vi.hoisted(() => ({
  app: {} as Record<string, any>,
  actions: {} as Record<string, any>,
}));

vi.mock('$lib/app.svelte', () => ({ app: h.app, App: class {} }));
vi.mock('$lib/ui/actionsRegistry.svelte', () => ({ actions: h.actions }));

import ActionMenu from '$lib/components/ActionMenu.svelte';

const ALBUM: Album = {
  id: 'al1',
  name: 'Neon Cartography',
  artistId: 'ar1',
  artistName: 'Aurelia Vance',
  songCount: 8,
  durationSec: 2400,
  starred: false,
};

const TRACK: Track = {
  id: 't1',
  title: 'Meridian Drift',
  albumId: 'al1',
  artistId: 'ar1',
  durationSec: 215,
  starred: false,
};

function buildFakes() {
  const keyboard = new KeyboardRouter({ activeScopes: () => ['overlay', 'global'] });
  const ui = {
    state: {
      overlay: 'actions' as string | null,
      actionTarget: { kind: 'album', id: 'al1', title: 'Neon Cartography', album: ALBUM } as any,
    },
    closeActions: vi.fn(() => {
      ui.state.overlay = null;
      ui.state.actionTarget = null;
    }),
    closeOverlay: vi.fn(() => {
      ui.state.overlay = null;
    }),
    openActions: vi.fn(),
  };
  const favorites = {
    isAlbumStarred: vi.fn(() => false),
    isTrackStarred: vi.fn(() => false),
    isArtistStarred: vi.fn(() => false),
  };
  const listenLater = { has: vi.fn(() => false) };
  const app = { ui, favorites, listenLater, keyboard };

  const actions = {
    playAlbumNow: vi.fn(),
    enqueueAlbum: vi.fn(),
    toggleAlbumFavorite: vi.fn(),
    toggleListenLater: vi.fn(),
    openAlbum: vi.fn(),
    openArtist: vi.fn(),
    playTrackNow: vi.fn(),
    enqueueTrack: vi.fn(),
    toggleTrackFavorite: vi.fn(),
    toggleListenLaterForTrack: vi.fn(),
    playArtistNow: vi.fn(),
    toggleArtistFavorite: vi.fn(),
  };

  return { app, keyboard, ui, favorites, listenLater, actions };
}

type Fakes = ReturnType<typeof buildFakes>;

function install(fakes: Fakes): Fakes {
  for (const key of Object.keys(h.app)) delete h.app[key];
  Object.assign(h.app, fakes.app);
  for (const key of Object.keys(h.actions)) delete h.actions[key];
  Object.assign(h.actions, fakes.actions);
  return fakes;
}

function mount() {
  const fakes = install(buildFakes());
  render(ActionMenu);
  return fakes;
}

/** The overlay bindings the menu registered on mount. */
function bindings(fakes: Fakes) {
  return fakes.keyboard.bindings;
}

function bindingFor(fakes: Fakes, key: string) {
  const found = bindings(fakes).find((b) => b.keys.includes(key));
  if (!found) throw new Error(`no binding for ${key}`);
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ActionMenu', () => {
  it('lists the available album actions inside a titled dialog', async () => {
    mount();
    await tick();

    const dialog = screen.getByRole('dialog', { name: 'actions' });
    expect(dialog).toBeTruthy();

    expect(screen.getByText('album: Neon Cartography')).toBeTruthy();
    expect(screen.getByText('play album now')).toBeTruthy();
    expect(screen.getByText('add to end of queue')).toBeTruthy();
    expect(screen.getByText('toggle favourite')).toBeTruthy();
    expect(screen.getByText('toggle listen later')).toBeTruthy();
    expect(screen.getByText('go to artist')).toBeTruthy();
    // Every row advertises its single-key shortcut.
    expect(screen.getByText('[p]')).toBeTruthy();
  });

  it('omits "go to artist" when the album has no artist id', async () => {
    const fakes = buildFakes();
    fakes.app.ui.state.actionTarget = {
      kind: 'album',
      id: 'al1',
      title: 'Neon Cartography',
      album: { ...ALBUM, artistId: undefined },
    };
    install(fakes);
    render(ActionMenu);
    await tick();

    expect(screen.queryByText('go to artist')).toBeNull();
  });

  it('renders the favourite state detail from the favourites store', async () => {
    const fakes = buildFakes();
    fakes.favorites.isAlbumStarred.mockReturnValue(true);
    install(fakes);
    render(ActionMenu);
    await tick();

    expect(screen.getByText('starred')).toBeTruthy();
  });

  it('runs the highlighted action on Enter and closes the menu', async () => {
    const fakes = mount();
    await tick();

    bindingFor(fakes, 'enter').run();

    expect(fakes.actions.playAlbumNow).toHaveBeenCalledWith(ALBUM);
    expect(fakes.ui.closeActions).toHaveBeenCalled();
  });

  it('maps each single-key shortcut to its action', async () => {
    const fakes = mount();
    await tick();

    bindingFor(fakes, 'n').run();
    expect(fakes.actions.enqueueAlbum).toHaveBeenCalledWith(ALBUM, 'next');

    bindingFor(fakes, 'a').run();
    expect(fakes.actions.enqueueAlbum).toHaveBeenCalledWith(ALBUM, 'end');

    bindingFor(fakes, 'f').run();
    expect(fakes.actions.toggleAlbumFavorite).toHaveBeenCalledWith(ALBUM);

    bindingFor(fakes, 'o').run();
    expect(fakes.actions.openAlbum).toHaveBeenCalledWith('al1');

    bindingFor(fakes, 'y').run();
    expect(fakes.actions.openArtist).toHaveBeenCalledWith('ar1');
  });

  it('announces the track actions when the target is a track', async () => {
    const fakes = buildFakes();
    fakes.app.ui.state.actionTarget = {
      kind: 'track',
      id: 't1',
      title: 'Meridian Drift',
      track: TRACK,
    };
    install(fakes);
    render(ActionMenu);
    await tick();

    expect(screen.getByText('play now')).toBeTruthy();
    expect(screen.getByText('listen later (its album)')).toBeTruthy();
    expect(screen.queryByText('play album now')).toBeNull();

    bindingFor(fakes, 'p').run();
    expect(fakes.actions.playTrackNow).toHaveBeenCalledWith(TRACK);
  });

  it('only responds to its shortcuts while the actions overlay is open', async () => {
    const fakes = mount();
    await tick();

    fakes.ui.state.overlay = 'help';
    fakes.keyboard.handle({ key: 'p' });
    expect(fakes.actions.playAlbumNow).not.toHaveBeenCalled();

    fakes.ui.state.overlay = 'actions';
    fakes.keyboard.handle({ key: 'p' });
    expect(fakes.actions.playAlbumNow).toHaveBeenCalledWith(ALBUM);
  });

  it('offers a cancel row and does not swallow the app-level Escape binding', async () => {
    const fakes = mount();
    await tick();

    expect(screen.getByText('cancel')).toBeTruthy();
    expect(screen.getByText('[escape]')).toBeTruthy();

    // The menu owns no `escape` binding, so the shell's global escape handler
    // still receives the key — that is what actually closes the menu.
    const close = vi.fn();
    fakes.keyboard.register({
      keys: ['q', 'escape'],
      scope: 'global',
      group: 'windows',
      description: 'back / close',
      run: close,
    });

    expect(fakes.keyboard.handle({ key: 'Escape' })).toBe(true);
    expect(close).toHaveBeenCalled();
  });

  it('closes the menu on a backdrop click', async () => {
    const fakes = mount();
    await tick();

    const dialog = screen.getByRole('dialog', { name: 'actions' });
    const backdrop = dialog.parentElement as HTMLElement;

    // Clicking the dialog itself must not close it.
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(fakes.ui.closeOverlay).not.toHaveBeenCalled();

    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(fakes.ui.closeOverlay).toHaveBeenCalled();
  });

  it('does not accumulate keybindings when it is mounted again', async () => {
    const fakes = install(buildFakes());
    const baseline = fakes.keyboard.bindings.length;

    const first = render(ActionMenu);
    await tick();
    const registered = fakes.keyboard.bindings.length - baseline;
    expect(registered).toBeGreaterThan(0);

    first.unmount();
    expect(fakes.keyboard.bindings.length).toBe(baseline);

    render(ActionMenu);
    await tick();
    // Re-mounting registers the same set once, not twice.
    expect(fakes.keyboard.bindings.length - baseline).toBe(registered);
  });

  it('moves the highlight so Enter activates the row the user navigated to', async () => {
    // Regression: the menu built a ListCursor but never fed it the row count, so
    // j/k clamped against zero and Enter always fired "play album now" no matter
    // how far the user had navigated.
    const fakes = mount();
    await tick();

    fakes.keyboard.handle({ key: 'j' });
    bindingFor(fakes, 'enter').run();

    expect(fakes.actions.enqueueAlbum).toHaveBeenCalled();
    expect(fakes.actions.playAlbumNow).not.toHaveBeenCalled();
  });
});
