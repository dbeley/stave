import { describe, it, expect, vi } from 'vitest';
import {
  PlayerStore,
  type AudioEventName,
  type AudioPort,
  type PlayerDeps,
} from '$lib/player/player.svelte';
import { NullMediaSession } from '$lib/player/mediaSession';
import { QueueStore } from '$lib/stores/queue.svelte';
import { SettingsStore } from '$lib/stores/settings.svelte';
import type { Track } from '$lib/domain/types';
import type { AutoDjOutcome, AutoDjRequest } from '$lib/player/autodj';

function track(id: string, over: Partial<Track> = {}): Track {
  return { id, title: `Track ${id}`, durationSec: 200, starred: false, ...over };
}

class FakeAudio implements AudioPort {
  src = '';
  volume = 1;
  muted = false;
  currentTime = 0;
  duration = 0;
  paused = true;

  play = vi.fn(async () => {
    this.paused = false;
  });

  pause = vi.fn(() => {
    this.paused = true;
  });

  load = vi.fn();

  private readonly listeners = new Map<AudioEventName, Set<() => void>>();

  on(event: AudioEventName, handler: () => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  emit(event: AudioEventName): void {
    for (const handler of [...(this.listeners.get(event) ?? [])]) handler();
  }

  get listenerCount(): number {
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }
}

interface MakePlayerOptions extends Partial<PlayerDeps> {
  volume?: number;
  autoDjEnabled?: boolean;
  scrobblingEnabled?: boolean;
}

function makePlayer(options: MakePlayerOptions = {}) {
  const { volume, autoDjEnabled, scrobblingEnabled, ...deps } = options;
  const queue = (deps.queue as QueueStore | undefined) ?? new QueueStore({ storage: null });
  const settings = new SettingsStore(
    {
      autoDj: autoDjEnabled ?? false,
      scrobblingEnabled: scrobblingEnabled ?? false,
      ...(volume !== undefined ? { volume } : {}),
    },
    null,
  );
  const toasts = { info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const audio = new FakeAudio();
  let source: 'cache' | 'stream' = 'cache';

  const player = new PlayerStore({
    queue,
    settings,
    toasts: toasts as unknown as PlayerDeps['toasts'],
    client: () => null,
    resolveUrl: async () => ({ url: 'blob:resolved', source }),
    createAudio: () => audio,
    mediaSession: new NullMediaSession(),
    ...deps,
  });

  return {
    player,
    queue,
    settings,
    toasts,
    audio,
    setSource: (value: 'cache' | 'stream') => {
      source = value;
    },
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await tick();
}

describe('playTracks()', () => {
  it('replaces the queue, loads the resolved URL and ends up playing', async () => {
    const { player, queue, audio } = makePlayer();
    await player.playTracks([track('a'), track('b')], 1);

    expect(queue.tracks.map((t) => t.id)).toEqual(['a', 'b']);
    expect(queue.state.index).toBe(1);
    expect(player.track?.id).toBe('b');
    expect(player.state.status).toBe('playing');
    expect(audio.src).toBe('blob:resolved');
    expect(audio.load).toHaveBeenCalledTimes(1);
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it('records where the audio came from', async () => {
    const cachePlayer = makePlayer();
    await cachePlayer.player.playTracks([track('a')]);
    expect(cachePlayer.player.state.source).toBe('cache');

    const streamPlayer = makePlayer();
    streamPlayer.setSource('stream');
    await streamPlayer.player.playTracks([track('a')]);
    expect(streamPlayer.player.state.source).toBe('stream');
  });

  it('does nothing for an empty track list', async () => {
    const { player, queue, audio } = makePlayer();
    await player.playTracks([]);
    expect(queue.isEmpty).toBe(true);
    expect(audio.play).not.toHaveBeenCalled();
  });

  it('reports a playback failure as an error and toasts', async () => {
    const { player, audio, toasts } = makePlayer();
    audio.play.mockRejectedValueOnce(new Error('codec exploded'));
    await player.playTracks([track('a')]);
    expect(player.state.status).toBe('error');
    expect(player.state.error).toBe('codec exploded');
    expect(toasts.error).toHaveBeenCalled();
  });
});

describe('play() / pause() / toggle()', () => {
  it('pause() pauses the audio and marks the state', async () => {
    const { player, audio } = makePlayer();
    await player.playTracks([track('a')]);
    player.pause();
    expect(audio.pause).toHaveBeenCalled();
    expect(player.state.status).toBe('paused');
  });

  it('toggle() flips between playing and paused', async () => {
    const { player } = makePlayer();
    await player.playTracks([track('a')]);
    await player.toggle();
    expect(player.state.status).toBe('paused');
    await player.toggle();
    expect(player.state.status).toBe('playing');
  });

  it('play() with nothing loaded starts the queue', async () => {
    const queue = new QueueStore({ storage: null });
    queue.set([track('a'), track('b')], 0);
    const { player } = makePlayer({ queue });
    await player.play();
    expect(player.track?.id).toBe('a');
    expect(player.state.status).toBe('playing');
  });
});

describe('ended event', () => {
  it('advances to the next track', async () => {
    const { player, queue, audio } = makePlayer();
    await player.playTracks([track('a'), track('b')], 0);
    audio.emit('ended');
    await settle();
    expect(player.track?.id).toBe('b');
    expect(queue.state.index).toBe(1);
    expect(player.state.status).toBe('playing');
  });

  it('stops at the end of the queue when the auto-DJ is off', async () => {
    const { player, audio } = makePlayer();
    await player.playTracks([track('a')], 0);
    audio.emit('ended');
    await settle();
    expect(player.state.status).toBe('idle');
    expect(audio.pause).toHaveBeenCalled();
  });

  it('asks the auto-DJ for more and plays what it returns', async () => {
    const autoDj = vi.fn(async (_request: AutoDjRequest): Promise<AutoDjOutcome> => ({
      tracks: [track('auto1')],
      source: 'heuristic',
    }));
    const { player, queue, settings, toasts, audio } = makePlayer({ autoDj });
    await player.playTracks([track('a')], 0);
    settings.update({ autoDj: true, autoDjThreshold: 0 });

    audio.emit('ended');
    await settle();

    expect(autoDj).toHaveBeenCalledTimes(1);
    expect(player.track?.id).toBe('auto1');
    expect(queue.tracks.map((t) => t.id)).toEqual(['a', 'auto1']);
    expect(player.state.autoDjAdded).toBe(1);
    expect(toasts.info).toHaveBeenCalled();
  });

  it('replays the same track when the ended event fires with repeat "one"', async () => {
    // BUG (src/lib/player/player.svelte.ts:235-251): the repeat-one branch of
    // next() ignores userInitiated, so the 'ended' event (which calls
    // next(false)) advances to the following track instead of replaying the
    // current one. A manual skip should move on; the ended event should replay.
    const { player, queue, audio } = makePlayer();
    await player.playTracks([track('a'), track('b')], 0);
    queue.setRepeat('one');
    audio.emit('ended');
    await settle();
    expect(player.track?.id).toBe('a');
    expect(queue.state.index).toBe(0);
  });
});

describe('seeking', () => {
  it('seek() clamps to [0, duration]', async () => {
    const { player } = makePlayer();
    await player.playTracks([track('a', { durationSec: 200 })]);
    player.seek(250);
    expect(player.state.position).toBe(200);
    player.seek(-5);
    expect(player.state.position).toBe(0);
  });

  it('seekBy() moves relative to the current position, clamped', async () => {
    const { player } = makePlayer();
    await player.playTracks([track('a', { durationSec: 200 })]);
    player.seekBy(30);
    expect(player.state.position).toBe(30);
    player.seekBy(500);
    expect(player.state.position).toBe(200);
  });

  it('uses the audio duration when the track one is unknown', () => {
    const { player, audio } = makePlayer();
    audio.duration = 50;
    player.seek(999);
    expect(player.state.position).toBe(50);
  });

  it('seekFraction() maps a fraction of the duration and is a no-op without one', async () => {
    const { player } = makePlayer();
    await player.playTracks([track('a', { durationSec: 200 })]);
    player.seekFraction(0.5);
    expect(player.state.position).toBe(100);
    player.seekFraction(2);
    expect(player.state.position).toBe(200);
    player.seekFraction(-1);
    expect(player.state.position).toBe(0);

    const idle = makePlayer();
    idle.player.seekFraction(0.5);
    expect(idle.player.state.position).toBe(0);
  });
});

describe('volume', () => {
  it('setVolume() clamps 0..1 and persists into settings', () => {
    const { player, settings, audio } = makePlayer({ volume: 0.5 });
    expect(audio.volume).toBe(0.5);

    player.setVolume(0.25);
    expect(audio.volume).toBe(0.25);
    expect(settings.state.volume).toBe(0.25);

    player.setVolume(2);
    expect(audio.volume).toBe(1);
    player.setVolume(-1);
    expect(audio.volume).toBe(0);
    expect(settings.state.volume).toBe(0);
  });

  it('volumeBy() adjusts relative and toggleMute() flips mute', () => {
    const { player, audio } = makePlayer({ volume: 0.5 });
    player.volumeBy(0.25);
    expect(audio.volume).toBe(0.75);
    expect(player.muted).toBe(false);
    player.toggleMute();
    expect(player.muted).toBe(true);
    expect(audio.muted).toBe(true);
  });
});

describe('next() / previous()', () => {
  it('next() advances through the queue', async () => {
    const { player, queue } = makePlayer();
    await player.playTracks([track('a'), track('b')], 0);
    await player.next();
    expect(player.track?.id).toBe('b');
    expect(queue.state.index).toBe(1);
  });

  it('next() stops at the end when the auto-DJ is off', async () => {
    const { player } = makePlayer();
    await player.playTracks([track('a')], 0);
    await player.next();
    expect(player.state.status).toBe('idle');
  });

  it('previous() restarts the track when past the first few seconds', async () => {
    const { player, audio } = makePlayer();
    await player.playTracks([track('a'), track('b')], 1);
    audio.currentTime = 10;
    audio.emit('timeupdate');
    expect(player.state.position).toBe(10);

    await player.previous();
    expect(player.track?.id).toBe('b');
    expect(player.state.position).toBe(0);
    expect(audio.currentTime).toBe(0);
  });

  it('previous() steps back when near the start', async () => {
    const { player, queue } = makePlayer();
    await player.playTracks([track('a'), track('b')], 1);
    await player.previous();
    expect(player.track?.id).toBe('a');
    expect(queue.state.index).toBe(0);
  });
});

describe('audio error handling', () => {
  it('counts consecutive failures and stops with a warning', async () => {
    const { player, toasts, audio } = makePlayer();
    await player.playTracks([track('a')], 0);

    audio.emit('error');
    expect(toasts.warn).not.toHaveBeenCalled();
    audio.emit('error');
    expect(toasts.warn).not.toHaveBeenCalled();
    audio.emit('error');
    await settle();

    expect(toasts.error).toHaveBeenCalledTimes(3);
    expect(toasts.warn).toHaveBeenCalledTimes(1);
    expect(player.state.status).toBe('idle');
  });
});

describe('enqueue()', () => {
  it('appends to the end by default and returns how many were added', async () => {
    const { player, queue } = makePlayer();
    await player.playTracks([track('a')]);
    expect(player.enqueue([track('b'), track('c')])).toBe(2);
    expect(queue.tracks.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(player.enqueue([])).toBe(0);
  });

  it('inserts after the current track in "next" mode', async () => {
    const { player, queue } = makePlayer();
    await player.playTracks([track('a'), track('b')], 0);
    player.enqueue([track('x')], 'next');
    expect(queue.tracks.map((t) => t.id)).toEqual(['a', 'x', 'b']);
  });
});

describe('repeat/shuffle delegation', () => {
  it('forwards to the queue', async () => {
    const { player, queue } = makePlayer();
    await player.playTracks([track('a'), track('b')], 0);
    expect(player.repeatMode).toBe('off');
    player.cycleRepeat();
    expect(player.repeatMode).toBe('all');
    expect(player.toggleShuffle()).toBe(true);
    expect(queue.shuffle).toBe(true);
  });
});

describe('destroy()', () => {
  it('detaches every audio listener', async () => {
    const { player, audio } = makePlayer();
    await player.playTracks([track('a')]);
    expect(audio.listenerCount).toBeGreaterThan(0);

    player.destroy();
    expect(audio.pause).toHaveBeenCalled();
    expect(audio.listenerCount).toBe(0);

    const position = player.state.position;
    audio.currentTime = 99;
    expect(() => audio.emit('timeupdate')).not.toThrow();
    expect(player.state.position).toBe(position);
  });
});
