/**
 * Sorting options for the album list, and the mapping onto Subsonic's
 * `getAlbumList2` types. Kept separate from the router so both can be tested
 * without dragging in the DOM.
 */

import type { AlbumListType } from '$lib/api/endpoints';

export type AlbumListSort =
  'newest' | 'random' | 'recent' | 'frequent' | 'alphabeticalByName' | 'alphabeticalByArtist';

export interface SortOption {
  id: AlbumListSort;
  label: string;
  hint: string;
  /** Server list type. */
  type: AlbumListType;
  /** Whether the list is stable enough to paginate. */
  paginated: boolean;
}

export const SORT_OPTIONS: readonly SortOption[] = [
  { id: 'newest', label: 'recently added', hint: 'r', type: 'newest', paginated: true },
  // `random` is the only sort that genuinely cannot paginate: asking the server
  // for the next offset returns a different shuffle, so pages would overlap and
  // repeat. `recent` and `frequent` are ordered server-side and stable across
  // offset pages, so they can — they were marked unpaginated by mistake, which is
  // why "most played" and "recently played" stopped after one page.
  { id: 'random', label: 'random', hint: 'z', type: 'random', paginated: false },
  { id: 'recent', label: 'recently played', hint: 'p', type: 'recent', paginated: true },
  { id: 'frequent', label: 'most played', hint: 'm', type: 'frequent', paginated: true },
  {
    id: 'alphabeticalByName',
    label: 'album A-Z',
    hint: 'a',
    type: 'alphabeticalByName',
    paginated: true,
  },
  {
    id: 'alphabeticalByArtist',
    label: 'artist A-Z',
    hint: 'b',
    type: 'alphabeticalByArtist',
    paginated: true,
  },
];

export function sortOption(id: AlbumListSort): SortOption {
  return SORT_OPTIONS.find((option) => option.id === id) ?? SORT_OPTIONS[0]!;
}

/** Next sort option, for the keyboard shortcut that cycles them. */
export function nextSort(id: AlbumListSort, direction = 1): AlbumListSort {
  const index = SORT_OPTIONS.findIndex((option) => option.id === id);
  const safeIndex = index < 0 ? 0 : index;
  const next = (safeIndex + direction + SORT_OPTIONS.length) % SORT_OPTIONS.length;
  return SORT_OPTIONS[next]!.id;
}
