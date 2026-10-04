import { describe, it, expect, vi } from 'vitest';
import { NativeMediaSession } from '$lib/player/mediaSession';
import type { Track } from '$lib/domain/types';

/**
 * The Android port. `navigator.mediaSession` does not exist in the Android
 * WebView, so this plugin is the only thing that can put the track on the lock
 * screen — and, through its `mediaPlayback` foreground service, the only thing
 * that keeps the WebView alive while the app is backgrounded.
 *
 * The plugin itself cannot run in jsdom, so it is faked structurally; what is
 * asserted is the translation between our port and its API.
 */
function track(overrides: Partial<Track> = {}): Track {
  return { id: 't1', title: 'Meridian Drift', durationSec: 200, starred: false, ...overrides };
}

function makeApi() {
  return {
    setMetadata: vi.fn().mockResolvedValue(undefined),
    setPlaybackState: vi.fn().mockResolvedValue(undefined),
    setPositionState: vi.fn().mockResolvedValue(undefined),
    setActionHandler: vi.fn().mockResolvedValue(undefined),
  };
}

describe('NativeMediaSession', () => {
  it('publishes metadata, cover included, for the notification', () => {
    const api = makeApi();

    new NativeMediaSession(api).update(
      track({ artistName: 'Aurelia Vance', albumName: 'Neon Cartography' }),
      { coverArt: 'https://example.test/cover/1' },
    );

    expect(api.setMetadata).toHaveBeenCalledWith({
      title: 'Meridian Drift',
      artist: 'Aurelia Vance',
      album: 'Neon Cartography',
      artwork: [{ src: 'https://example.test/cover/1', sizes: '600x600' }],
    });
  });

  it('publishes no metadata when nothing is playing', () => {
    const api = makeApi();

    new NativeMediaSession(api).update(undefined, {});

    // Empty strings would put a blank entry in the notification shade.
    expect(api.setMetadata).not.toHaveBeenCalled();
  });

  it('maps the playback state straight through', () => {
    const api = makeApi();
    const port = new NativeMediaSession(api);

    port.setPlaybackState('playing');
    port.setPlaybackState('paused');
    port.setPlaybackState('none');

    expect(api.setPlaybackState.mock.calls.map((call) => call[0])).toEqual([
      { playbackState: 'playing' },
      { playbackState: 'paused' },
      { playbackState: 'none' },
    ]);
  });

  it('clamps the position, and refuses a duration it cannot trust', () => {
    const api = makeApi();
    const port = new NativeMediaSession(api);

    port.setPosition(200, 250, 1);
    expect(api.setPositionState).toHaveBeenCalledWith({
      duration: 200,
      playbackRate: 1,
      position: 200,
    });

    api.setPositionState.mockClear();
    port.setPosition(0, 10, 1);
    expect(api.setPositionState).not.toHaveBeenCalled();
  });

  it('forwards every media action, seek time included', () => {
    const api = makeApi();
    const handlers = {
      play: vi.fn(),
      pause: vi.fn(),
      next: vi.fn(),
      previous: vi.fn(),
      seek: vi.fn(),
    };

    new NativeMediaSession(api).bind(handlers);

    expect(api.setActionHandler.mock.calls.map((call) => call[0].action)).toEqual([
      'play',
      'pause',
      'nexttrack',
      'previoustrack',
      'stop',
      'seekto',
    ]);

    // A head-unit or notification control has to reach the handler.
    const seekHandler = api.setActionHandler.mock.calls.find(
      (call) => call[0].action === 'seekto',
    )?.[1];
    seekHandler?.({ seekTime: 42 });
    expect(handlers.seek).toHaveBeenCalledWith(42);
  });

  it('registers no seek handler when the player has none', () => {
    const api = makeApi();

    new NativeMediaSession(api).bind({
      play: vi.fn(),
      pause: vi.fn(),
      next: vi.fn(),
      previous: vi.fn(),
    });

    expect(api.setActionHandler.mock.calls.some((call) => call[0].action === 'seekto')).toBe(false);
  });

  it('swallows a native failure instead of breaking playback', async () => {
    const api = makeApi();
    api.setPlaybackState.mockRejectedValue(new Error('no foreground service'));
    api.setMetadata.mockImplementation(() => {
      throw new Error('broken synchronously');
    });

    const port = new NativeMediaSession(api);

    // The OS controls are a nicety; the music must survive them failing.
    expect(() => port.setPlaybackState('playing')).not.toThrow();
    expect(() => port.update(track(), {})).not.toThrow();

    // Let the rejected promise settle: an unhandled rejection fails the run.
    await Promise.resolve();
  });
});
