import { describe, expect, it } from 'vitest';
import { UiStore } from '$lib/stores/ui.svelte';
import type { Album } from '$lib/domain/types';

const album: Album = { id: 'al1', name: 'Album', songCount: 1, durationSec: 10, starred: false };

describe('UiStore', () => {
  it('starts with no overlay', () => {
    const ui = new UiStore();
    expect(ui.state.overlay).toBeNull();
    expect(ui.anyOverlayOpen).toBe(false);
    expect(ui.isOpen('help')).toBe(false);
  });

  it('opens, replaces and closes overlays', () => {
    const ui = new UiStore();
    ui.openOverlay('help');
    expect(ui.isOpen('help')).toBe(true);
    expect(ui.anyOverlayOpen).toBe(true);

    ui.openOverlay('queue');
    expect(ui.isOpen('help')).toBe(false);
    expect(ui.isOpen('queue')).toBe(true);

    ui.closeOverlay();
    expect(ui.anyOverlayOpen).toBe(false);
  });

  it('toggles an overlay with the same key', () => {
    const ui = new UiStore();
    ui.toggleOverlay('queue');
    expect(ui.isOpen('queue')).toBe(true);
    ui.toggleOverlay('queue');
    expect(ui.isOpen('queue')).toBe(false);
  });

  it('opening a different overlay via toggle switches rather than closes', () => {
    const ui = new UiStore();
    ui.toggleOverlay('help');
    ui.toggleOverlay('queue');
    expect(ui.isOpen('queue')).toBe(true);
  });

  it('carries the action target and the overlay together', () => {
    const ui = new UiStore();
    ui.openActions({ kind: 'album', id: 'al1', title: 'Album', album });

    expect(ui.isOpen('actions')).toBe(true);
    expect(ui.state.actionTarget?.kind).toBe('album');
    expect(ui.state.actionTarget?.album?.name).toBe('Album');

    ui.closeActions();
    expect(ui.state.actionTarget).toBeNull();
    expect(ui.isOpen('actions')).toBe(false);
  });

  it('closing actions does not disturb a different overlay', () => {
    const ui = new UiStore();
    ui.openOverlay('help');
    ui.closeActions();
    expect(ui.isOpen('help')).toBe(true);
  });

  it('toggles the sidebar and resets transient state', () => {
    const ui = new UiStore();
    ui.toggleSidebar();
    expect(ui.state.sidebarVisible).toBe(false);

    ui.openActions({ kind: 'track', id: 't1', title: 'Track' });
    ui.reset();
    expect(ui.state.overlay).toBeNull();
    expect(ui.state.actionTarget).toBeNull();
    expect(ui.state.commandMode).toBe(false);
  });

  it('accepts initial state', () => {
    const ui = new UiStore({ overlay: 'queue', sidebarVisible: false });
    expect(ui.isOpen('queue')).toBe(true);
    expect(ui.state.sidebarVisible).toBe(false);
  });
});
