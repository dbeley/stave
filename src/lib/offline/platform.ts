/**
 * Platform detection and the choice of blob storage backend.
 *
 * Web: IndexedDB blobs. Android/iOS (Capacitor): real files in the app data
 * directory, which survive WebView cache purges and do not fight the browser
 * quota. The Capacitor API is imported lazily so the web bundle never needs the
 * native runtime.
 */

import type { OfflineDatabase } from './db';
import { IdbBlobStore, NativeFileStore, type BlobStore } from './blobStore';

export interface CapacitorLike {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

/** Capacitor registers `window.Capacitor` on the web too — check the platform. */
export function isNativePlatform(capacitor?: CapacitorLike | null): boolean {
  const cap = capacitor ?? (globalThis as { Capacitor?: CapacitorLike }).Capacitor;
  if (!cap) return false;
  if (typeof cap.isNativePlatform === 'function') {
    try {
      return cap.isNativePlatform();
    } catch {
      return false;
    }
  }
  const platform = typeof cap.getPlatform === 'function' ? cap.getPlatform() : undefined;
  return Boolean(platform && platform !== 'web');
}

/** True only inside the Android Capacitor shell. */
export function isAndroidPlatform(capacitor?: CapacitorLike | null): boolean {
  const cap = capacitor ?? (globalThis as { Capacitor?: CapacitorLike }).Capacitor;
  if (!cap) return false;
  try {
    return typeof cap.getPlatform === 'function' && cap.getPlatform() === 'android';
  } catch {
    return false;
  }
}

export function createBlobStore(
  db: OfflineDatabase,
  options: { native?: boolean } = {},
): BlobStore {
  if (options.native ?? isNativePlatform()) {
    return new NativeFileStore();
  }
  return new IdbBlobStore(db);
}

/** Human-readable platform label for the settings page. */
export function platformLabel(): string {
  try {
    const cap = (globalThis as { Capacitor?: CapacitorLike }).Capacitor;
    const platform = typeof cap?.getPlatform === 'function' ? cap.getPlatform() : undefined;
    if (platform && platform !== 'web') return platform;
  } catch {
    /* fall through */
  }
  return 'web';
}
