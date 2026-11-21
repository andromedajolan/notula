# Notula data format

Notula saves each chart as a **project**: one JSON object. The same object is what Export / Import writes and reads (`*.notula.json`).
Everything is local. Notula keeps projects in IndexedDB (`notula-db`, stores `projects` and `prev`); `prev` holds the version before the last save.

## Version

`schema` is an integer, currently **2**. A reader must refuse files whose `schema` is higher than it knows, and ignore fields it does not know.

* **Schema 1**: MIDI projects (`source.kind` `"midi"`). Unchanged. Notula 0.2.0 still opens and saves them as schema 1.
* **Schema 2** (added in 0.2.0): adds Stilus chord-chart projects (`source.kind` `"stilus"`). Only chart projects use schema 2; a reader that only knows schema 1 will refuse them, which is the intended behaviour.

## MIDI project (schema 1)

```json
{
  "format": "notula-project",
  "schema": 1,
  "id": "np_mi3k2x9a1b2c",
  "created": "2026-11-21T08:00:00.000Z",
  "updated": "2026-11-21T08:05:12.000Z",
  "app": { "name": "Notula", "version": "0.1.0" },
  "meta": { "title": "My Song", "artist": "Andromeda Dunn", "part": "" },
  "songRef": null,
  "source": {
    "kind": "midi",
    "fileName": "My Song vocal.mid",
    "midiBase64": "TVRoZA...",
    "trackIndex": 0
  },
  "settings": {
    "feel": "strict",
    "trim": true,
    "shift": 0,
    "transpose": 0,
    "clef": "auto",
    "keyOverride": null,
    "page": "letter",
    "zoom": null
  },
  "marks": {
    "8": { "label": "Chorus", "repeatStart": true },
    "15": { "repeatEnd": true }
  }
}
```

| Field | Meaning |
|---|---|
| `id` | Stable project id (`np_` + random). Never changes after creation. |
| `created`, `updated` | ISO 8601 UTC timestamps. |
| `meta.title`, `meta.artist`, `meta.part` | Text printed in the chart header. |
| `songRef` | Optional link to a Stilus song: `{ "id": "<stilus song id>", "title": "..." }`, or `null`. Always `null` for MIDI projects in 0.2.0. Must never be required. |
| `source.midiBase64` | The original MIDI file, base64. Notation is always rebuilt from this, so changing quantize, key or transpose never loses information. |
| `source.trackIndex` | Index into the tracks Notula lists for the file (one entry per track per channel, in file order, tracks without notes skipped). |
| `settings.feel` | `"strict"` (16th grid plus triplets, tiny gaps merged) or `"natural"` (32th grid, closer to what was played). |
| `settings.trim` | Drop empty bars at the start. |
| `settings.shift` | Move the music later (+) or earlier (-) against the bar lines, in 16ths. |
| `settings.transpose` | Semitones, -24 to 24. Applied to notes, key signature and spelling. |
| `settings.clef` | `"auto"`, `"treble"` or `"bass"`. |
| `settings.keyOverride` | `null` (use the key in the file, else detect it) or `{ "tonic": 0-11, "minor": false }`. This is the key of the *source* before transposing. |
| `settings.page` | `"letter"`, `"a4"` or `"screen"` (reflows to the screen width for reading on a phone; printing always uses Letter). |
| `settings.zoom` | `null` (fit width) or a number (1 = 100%). |
| `marks` | Per-bar marks keyed by **bar index, counted from 0 in the full file** (so trimming empty bars does not move them). Fields: `repeatStart`, `repeatEnd`, `doubleBar` (booleans), `label` (text, up to 24 characters). |

## Chord chart project (schema 2, from Stilus)

```json
{
  "format": "notula-project",
  "schema": 2,
  "id": "np_mi3k2x9a1b2c",
  "created": "2026-11-21T08:00:00.000Z",
  "updated": "2026-11-21T08:05:12.000Z",
  "app": { "name": "Notula", "version": "0.2.0" },
  "meta": { "title": "Still Here", "artist": "Andromeda Dunn", "part": "" },
  "songRef": { "id": "<stilus song id>", "title": "Still Here" },
  "source": {
    "kind": "stilus",
    "fileName": "stilus-backup.json",
    "song": { "v": 1, "id": "...", "title": "...", "key": "Bb", "mode": "major", "bpm": 112, "timeSig": "4/4", "sections": [ { "id": "...", "type": "Verse", "label": "", "lyrics": "[Bb]I was [Gm]standing" } ] }
  },
  "settings": { "transpose": 0, "page": "letter", "zoom": null, "chart": { "view": "both", "columns": 1 } },
  "marks": {}
}
```

| Field | Meaning |
|---|---|
| `songRef.id` | The Stilus song `id`. Importing the same song again offers to update this project instead of adding a copy. |
| `source.song` | A copy of the Stilus song object as imported (the Stilus data format, `v` 1). Every field is kept, including ones Notula does not use. Chords are written inline in `lyrics` as `[Bb]`, exactly as in Stilus. The chart is always rebuilt from this, so transposing never changes the stored song. |
| `source.fileName` | The file it was imported from (a single song, or a `lyricwriter-backup` where one song was picked). |
| `settings.transpose` | Semitones, -24 to 24. Chords are respelled for the new key (flats or sharps follow the key, as in Stilus). |
| `settings.page`, `settings.zoom` | Same as MIDI projects. |
| `settings.chart.view` | `"both"` (chords over lyrics), `"chords"` (progression per line) or `"lyrics"`. |
| `settings.chart.columns` | `1` or `2` (2 only applies to Letter and A4). |
| `marks` | Always `{}` for charts. |

Notula reads Stilus songs, backups (`format: "lyricwriter-backup"`, `v` 1, `songs[]`; songs with `deleted` set are skipped), a bare array of songs, or a single song object (anything with a `sections` array). It never writes back to Stilus.

## Playback (no stored data)

Playback uses a built-in Web Audio synth; no samples or files are downloaded. The tempo slider, click, volume and the "As engraved / Original MIDI" choice are not saved in the project. Playback starts at the selected bar, or the beginning.

## Ianua hooks

* `suite-app.json` at the app root: `{ "schema": 1, "id": "notula", "name": "Notula", "version": "x.y.z", "updated": "YYYY-MM-DD" }`.
* localStorage key `notula.summary`: `{ "schema": 1, "appId": "notula", "version": "x.y.z", "lastOpened": "<ISO>", "recent": [ { "id", "title", "updated" } ] }`, newest first. Read-only for Ianua.

## Other storage names (this app only)

* IndexedDB `notula-db`; caches `notula-cache-<version>`; localStorage keys `notula.*` (`notula.lastProject`, `notula.summary`, and `notula.p.<id>`, a short-lived backup copy written when the page closes, or the main copy if IndexedDB is unavailable).
* Shared across the suite and only read: `studio.theme` (`dark`, `gray` or `light`).
