# Key bindings

The help overlay (`?`) is generated from the same registry these bindings live
in (`src/lib/keyboard/`), so this document and the running app cannot drift.

Chords are written the way they are typed. A **capital** letter means Shift
(`G`, not `shift+g`) — for printable keys Shift is part of the character. Named
keys do take the modifier (`ctrl+d`, `escape`). A space separates a sequence:
`g h` means `g` then `h`. The status bar shows a pending prefix (e.g. `[g]`)
while a sequence is half-typed; it expires after ~3s. While the prefix is
pending the hint bar lists **every binding that continues it**, so you can see
where `g` leads instead of having to remember.

Scope decides who wins when two bindings share a chord:
**overlay → queue window → global** while an overlay is open, otherwise
**page → global**. An open overlay is modal: the page underneath stops
receiving keys, so a page shortcut (say `A` on an album page) cannot fire while
you are browsing the queue window. Globals stay live so transport and
`q`/`escape` still work.

---

## Global — work anywhere

| key                   | action                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------- |
| `space`               | play / pause                                                                            |
| `n` / `N`             | next track                                                                              |
| `p`                   | previous track (restarts the track if you are past 3s)                                  |
| `s`                   | toggle shuffle                                                                          |
| `r`                   | cycle repeat: off → all → one                                                           |
| `+` / `=` , `-`       | volume up / down                                                                        |
| `m`                   | mute / unmute                                                                           |
| `l` / `→` , `h` / `←` | seek forward / back 5s                                                                  |
| `0`                   | restart the current track                                                               |
| `1` … `9`             | seek to 10% … 90%                                                                       |
| `g h`                 | home                                                                                    |
| `g a`                 | albums                                                                                  |
| `g r`                 | artists                                                                                 |
| `g p`                 | playlists                                                                               |
| `g f`                 | favourites                                                                              |
| `g l`                 | listen later                                                                            |
| `g n`                 | now playing                                                                             |
| `g s`                 | settings                                                                                |
| `q` / `escape`        | back / close the current overlay                                                        |
| `z`                   | next album sort order (from anywhere)                                                   |
| `R`                   | reload the current view from the server                                                 |
| `:`                   | go to… — the palette of destinations (also the touch navigation)                        |
| `?`                   | keyboard help                                                                           |
| `Q`                   | queue window                                                                            |
| `/`                   | search (focuses the field)                                                              |
| `T`                   | cycle theme (dark → light → amoled, plus `host` when the deployment supplies a palette) |
| `C`                   | cycle accent colour                                                                     |
| `D`                   | toggle auto-DJ                                                                          |
| `V`                   | toggle CRT scanline effects                                                             |

## Any list (page scope)

| key               | action                 |
| ----------------- | ---------------------- |
| `j` / `↓`         | move down              |
| `k` / `↑`         | move up                |
| `g g` / `home`    | first item             |
| `G` / `end`       | last item              |
| `ctrl+d` / `pgdn` | half page down         |
| `ctrl+u` / `pgup` | half page up           |
| `enter`           | activate (open / play) |
| `o`               | the item's action menu |

## Album rows (album list, artist page, home, search)

| key     | action                                                     |
| ------- | ---------------------------------------------------------- |
| `enter` | open the album page                                        |
| `p`     | play the album now — **replaces the queue**                |
| `a`     | add to the end of the queue                                |
| `f`     | toggle favourite (server-side star)                        |
| `L`     | toggle listen later (local only; drives the offline cache) |
| `o`     | action menu (its `n` is "play next")                       |
| `y`     | go to the artist                                           |

## Track rows (album page, playlist, artist top tracks, search)

| key     | action                                                                     |
| ------- | -------------------------------------------------------------------------- |
| `enter` | play now — **replaces the queue** with the surrounding list, starting here |
| `a`     | add to the end of the queue                                                |
| `f`     | toggle favourite                                                           |
| `L`     | toggle listen later for the track's album                                  |
| `o`     | action menu (its `n` is "play next")                                       |
| `y`     | go to the artist                                                           |

## Artist page

Three panes share the page — albums, top tracks, similar artists — and `tab`
moves between them. Only the focused pane's keys are live, so `j`/`k` and the
item keys always act on what you can see highlighted.

| key   | action                                                                              |
| ----- | ----------------------------------------------------------------------------------- |
| `tab` | switch pane (albums → top tracks → similar artists)                                 |
| `P`   | play the whole artist                                                               |
| `F`   | toggle the artist's favourite state                                                 |
| `o`   | artist actions (on the focused pane's item, so a similar artist gets _its_ actions) |
| `f`   | toggle the focused similar artist's favourite state                                 |

## Album page — album-level actions

Capital keys, so they never collide with the per-track ones above.

| key | action                                |
| --- | ------------------------------------- |
| `P` | play the whole album                  |
| `A` | add the album to the end of the queue |
| `F` | toggle the album's favourite state    |
| `L` | toggle listen later for this album    |

## Queue window (`Q`)

| key            | action                           |
| -------------- | -------------------------------- |
| `j` / `k`      | move the cursor                  |
| `enter`        | jump to that track and play it   |
| `x`            | remove the selected item         |
| `J` / `K`      | move the selected item down / up |
| `c`            | clear the queue                  |
| `s`            | shuffle the queue                |
| `d`            | toggle auto-DJ                   |
| `escape` / `q` | close                            |

## Home

| key   | action                                |
| ----- | ------------------------------------- |
| `tab` | switch pane (random ↔ recently added) |
| `r`   | reshuffle the random pane             |

## Albums page

Each sort order is a tab, and the strip is the same component as the favourites
sections — same look, same keys.

| key         | action              |
| ----------- | ------------------- |
| `tab`       | next sort order     |
| `shift+tab` | previous sort order |

`z` is a global shortcut: it jumps to the next order from any page and shows
which one it landed on.

## Now playing (`g n`)

The full view of the current track: cover, metadata, progress and transport, with
the queue underneath (same keys as the queue window, since it is the same list).

| key             | action                                     |
| --------------- | ------------------------------------------ |
| `j` / `k`       | move through the queue                     |
| `enter`         | jump to that track and play it             |
| `x`             | remove the selected item                   |
| `J` / `K`       | move the selected item down / up           |
| `c` / `s` / `d` | clear / shuffle the queue, toggle auto-DJ  |
| `o`             | the current track's action menu            |
| `f`             | toggle the current track's favourite state |
| `y`             | go to the track's artist                   |

## Search

While the field has focus every keystroke is text; `escape` leaves the field,
`↓` jumps into the results, `enter` runs the search and moves focus onto the
results so they can be navigated at once. In the results, navigation and item
keys work as for track/album rows, plus:

| key | action                                            |
| --- | ------------------------------------------------- |
| `a` | add to the end of the queue (album or track rows) |

## Settings

| key               | action                                             |
| ----------------- | -------------------------------------------------- |
| `j` / `k`         | move between rows                                  |
| `h` / `l`         | cycle the value of the focused row                 |
| `enter` / `space` | activate the row (toggle, cycle, or run an action) |

> On the settings page `h`/`l` are the row values, so they shadow the global
> seek bindings while that page is focused. That is intentional.

## Connect form

The form behaves like a normal form, on purpose: `tab` moves the real browser
focus, so the caret, the highlight and your typing always agree. (An earlier
version kept a separate highlight cursor and swallowed `tab`, which let the two
drift apart — the next field looked selected while you were still typing into the
previous one.)

| key                 | action                                                             |
| ------------------- | ------------------------------------------------------------------ |
| `tab` / `shift+tab` | next / previous field — native order, including the connect button |
| `enter`             | connect (on the remember row: tick it, then connect)               |
| `space`             | a space in a field, or toggle the checkbox                         |
| `alt+j` / `alt+k`   | the same movement without leaving the home row                     |
| `escape`            | close — only when it is not the blocking first-run form            |

## Touch / mouse

Every keyboard action has a visible affordance: rows are clickable, albums and
tracks carry inline buttons where the action is ambiguous (search results), the
album page has a toolbar, tapping the now-playing bar opens the now playing page,
and long-pressing is never required. Guards exist for
`prefers-reduced-motion` and for text fields, so typing never triggers shortcuts.
