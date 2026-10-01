# Key bindings

The help overlay (`?`) is generated from the same registry these bindings live
in (`src/lib/keyboard/`), so this document and the running app cannot drift.

Chords are written the way they are typed. A **capital** letter means Shift
(`G`, not `shift+g`) — for printable keys Shift is part of the character. Named
keys do take the modifier (`ctrl+d`, `escape`). A space separates a sequence:
`g h` means `g` then `h`. The status bar shows a pending prefix (e.g. `[g]`)
while a sequence is half-typed; it expires after ~1.2s.

Scope decides who wins when two bindings share a chord:
**overlay → queue window → page → global**. So an open overlay shadows the page,
and the page shadows the globals.

---

## Global — work anywhere

| key | action |
| --- | --- |
| `space` | play / pause |
| `n` / `N` | next track |
| `p` | previous track (restarts the track if you are past 3s) |
| `s` | toggle shuffle |
| `r` | cycle repeat: off → all → one |
| `+` / `=` , `-` | volume up / down |
| `m` | mute / unmute |
| `l` / `→` , `h` / `←` | seek forward / back 5s |
| `0` | restart the current track |
| `1` … `9` | seek to 10% … 90% |
| `g h` | home |
| `g a` | albums |
| `g r` | artists |
| `g p` | playlists |
| `g f` | favourites |
| `g l` | listen later |
| `g s` | settings |
| `q` / `escape` | back / close the current overlay |
| `z` | next album sort order (on the albums page) |
| `R` | reload the current view from the server |
| `?` | keyboard help |
| `Q` | queue window |
| `/` | search (focuses the field) |
| `T` | cycle theme (dark → light → amoled) |
| `C` | cycle accent colour |
| `D` | toggle auto-DJ |
| `V` | toggle CRT scanline effects |

## Any list (page scope)

| key | action |
| --- | --- |
| `j` / `↓` | move down |
| `k` / `↑` | move up |
| `g g` / `home` | first item |
| `G` / `end` | last item |
| `ctrl+d` / `pgdn` | half page down |
| `ctrl+u` / `pgup` | half page up |
| `enter` | activate (open / play) |
| `o` | the item's action menu |

## Album rows (album list, artist page, home, search)

| key | action |
| --- | --- |
| `enter` | open the album page |
| `p` | play the album now — **replaces the queue** |
| `n` | play next — queues it right after the current track |
| `a` | add to the end of the queue |
| `f` | toggle favourite (server-side star) |
| `L` | toggle listen later (local only; drives the offline cache) |
| `o` | action menu |
| `y` | go to the artist |

## Track rows (album page, playlist, artist top tracks, search)

| key | action |
| --- | --- |
| `enter` | play now — **replaces the queue** with the surrounding list, starting here |
| `n` | play next |
| `a` | add to the end of the queue |
| `f` | toggle favourite |
| `L` | toggle listen later for the track's album |
| `o` | action menu |
| `y` | go to the artist |

## Album page — album-level actions

Capital keys, so they never collide with the per-track ones above.

| key | action |
| --- | --- |
| `P` | play the whole album |
| `N` | play the album next |
| `A` | add the album to the end of the queue |
| `F` | toggle the album's favourite state |
| `L` | toggle listen later for this album |

## Queue window (`Q`)

| key | action |
| --- | --- |
| `j` / `k` | move the cursor |
| `enter` | jump to that track and play it |
| `x` | remove the selected item |
| `J` / `K` | move the selected item down / up |
| `c` | clear the queue |
| `s` | shuffle the queue |
| `d` | toggle auto-DJ |
| `escape` / `q` | close |

## Home

| key | action |
| --- | --- |
| `tab` | switch pane (random ↔ recently added) |
| `r` | reshuffle the random pane |

## Albums page

| key | action |
| --- | --- |
| `z` / `Z` | next / previous sort order |

## Search

While the field has focus every keystroke is text; `escape` leaves the field,
`↓` jumps into the results, `enter` runs the search immediately. In the results,
navigation and item keys work as for track/album rows, plus:

| key | action |
| --- | --- |
| `a` | add to the end of the queue (album or track rows) |
| `n` | play next |

## Settings

| key | action |
| --- | --- |
| `j` / `k` | move between rows |
| `h` / `l` | cycle the value of the focused row |
| `enter` / `space` | activate the row (toggle, cycle, or run an action) |

> On the settings page `h`/`l` are the row values, so they shadow the global
> seek bindings while that page is focused. That is intentional.

## Touch / mouse

Every keyboard action has a visible affordance: rows are clickable, albums and
tracks carry inline buttons where the action is ambiguous (search results), the
album page has a toolbar, and long-pressing is never required. Guards exist for
`prefers-reduced-motion` and for text fields, so typing never triggers shortcuts.
