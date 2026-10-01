/** Display formatting helpers. Pure functions — easy to test, used everywhere. */

/** 215 -> "3:35", 3725 -> "1:02:05" */
export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '--:--';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

/** Long-form duration: "1 h 02 min", "45 min", "12 s". */
export function formatLongDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, '0')} min`;
  if (minutes > 0) return `${minutes} min`;
  return `${total} s`;
}

/** 12 -> "12", 1536 -> "1.5k", 2400000 -> "2.4M" */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${trimZero(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${trimZero(value / 1_000)}k`;
  return String(value);
}

function trimZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}

/** 3.5 -> "3.5 MB" */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** "Aurelia Vance — Neon Cartography" */
export function formatAlbumSubtitle(
  artistName: string | undefined,
  year: number | undefined,
): string {
  const parts = [artistName, year ? String(year) : undefined].filter(Boolean);
  return parts.join(' · ');
}

/** Pluralise without pulling in an i18n library. */
export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

/** "1 album", "5 albums" */
export function countAlbums(count: number): string {
  return `${count} ${pluralize(count, 'album')}`;
}

/** "1 track", "5 tracks" */
export function countTracks(count: number): string {
  return `${count} ${pluralize(count, 'track')}`;
}

/** Escape text for use inside an ARIA label / attribute. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}
