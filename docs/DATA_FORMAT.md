# Notula data format

Notula saves each chart as a **project**: one JSON object. The same object is what Export / Import writes and reads (`*.notula.json`).
Everything is local. Notula keeps projects in IndexedDB (`notula-db`, stores `projects` and `prev`); `prev` holds the version before the last save.

## Version

`schema` is an integer, currently **3**. A reader must refuse files whose `schema` is higher than it knows, and ignore fields it does not know.

* **Schema 1**: MIDI projects (`source.kind` `"midi"`). Unchanged. Notula 0.2.0 still opens and saves them as schema 1.
* **Schema 2** (0.2.0): adds Stilus chord-chart projects (`source.kind` `"stilus"`).
* **Schema 3** (0.3.0): adds `chords`, `lyrics`, `edit`, `song`, `settings.bars`, `settings.tab` and the blank score (`source.kind` `"blank"`). Notula 0.3.0 saves every project as schema 3. Schema 1 and 2 files still open: the missing fields are filled with empty defaults and nothing is removed. Older readers refuse schema 3 files, which is intended.

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

## Fields added in schema 3 (melody projects: MIDI or blank)

```json
{
  "schema": 3,
  "source": { "kind": "blank", "fileName": "" },
  "edit": {
    "notes": [ { "u": 0, "d": 48, "p": 71 } ],
    "tempos": [ { "u": 0, "bpm": 100 } ],
    "timeSigs": [ { "u": 0, "num": 4, "den": 4 } ],
    "base": { "shift": 0, "transpose": 0, "keyOverride": null }
  },
  "chords": [ { "u": 0, "t": "Bb" } ],
  "lyrics": { "text": "I was stand-ing in the rain", "start": 0 },
  "song": null,
  "settings": { "feel": "exact", "trim": true, "shift": 0, "transpose": 0, "clef": "auto", "keyOverride": { "tonic": 0, "minor": false }, "page": "letter", "zoom": null, "bars": 8, "tab": { "tuning": "off", "pos": "auto" } }
}
```

| Field | Meaning |
|---|---|
| `source.kind` | `"midi"` (a file, as before), `"stilus"` (chord chart), or `"blank"` (a score typed by hand: no MIDI data, `edit` is required). |
| `edit` | The notes edited by hand. Absent or `null` means the notation is built from `source.midiBase64` as in schema 1. When present, it replaces the MIDI as the source of the notes (the original MIDI stays in `source.midiBase64` for "Discard my edits"). Editing a MIDI project copies the notes as they appear on the page (quantized, ties merged, shift and transpose applied) and resets `settings.shift` and `settings.transpose` to 0; `edit.base` remembers the old values for going back. |
| `edit.notes[]` | `u` start and `d` length in score units (48 per quarter note, so a 16th is 12 and an eighth triplet is 16), `p` MIDI pitch 0-127. One note at a time (monophonic). Gaps between notes are rests. Stored before `settings.shift` and `settings.transpose` are applied. |
| `edit.tempos[]`, `edit.timeSigs[]` | Tempo (`bpm`) and time signature changes at unit `u`. Bars are counted from unit 0. |
| `chords[]` | Chord symbols above the staff. `u` is the position in score units from the start of the piece (bar positions, not moved by `settings.shift`), `t` the text, written for the stored key: `settings.transpose` is applied when drawing. |
| `lyrics` | `null` or `{ text, start }`. `text` is split on spaces; a hyphen inside a word splits it into syllables (`stand-ing`), `_` skips a note. One syllable goes under each note that begins a note (ties do not count), starting at the note with index `start` (0 = first note on the page). |
| `song` | `null`, or a copy of a Stilus song (same shape as `source.song` in chart projects) linked for lyrics and chords. `songRef` holds its id and title. |
| `settings.feel` | Gains `"exact"`: notes are already on the grid and are neither snapped nor merged. Used automatically when `edit` is present. |
| `settings.bars` | Show at least this many bars (default 0). Blank scores start with 8. |
| `settings.tab` | `{ tuning, pos }`. `tuning` is `"off"` or one of `gtr-std`, `gtr-dropd`, `gtr-halfdown`, `gtr-fulldown`, `gtr-dadgad`, `gtr-openg`, `gtr-opend`, `bass-4`, `bass-dropd`, `bass-halfdown`, `bass-5`. `pos` is `"auto"`, `"low"`, `"mid"` or `"high"`. Frets are worked out when drawing and are not stored. |

Tab uses the sounding pitch of each note. The staff above is written at the same pitch (no octave clef), so guitar notation reads an octave lower than it sounds.

## Chord chart project (schema 2 and up, from Stilus)

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

## MIDI out

"Export MIDI (.mid)" writes a Format 0 file at 480 ppq with the notes as shown on the page (shift and transpose applied, ties joined), the file's tempo and time signature changes, and the key signature. Lyrics, chords and tab are not written.

## Playback (no stored data)

Playback uses a built-in Web Audio synth; no samples or files are downloaded. The tempo slider, click, volume and the "As engraved / Original MIDI" choice are not saved in the project. Playback starts at the selected bar, or the beginning.

## Ianua hooks

* `suite-app.json` at the app root: `{ "schema": 1, "id": "notula", "name": "Notula", "version": "x.y.z", "updated": "YYYY-MM-DD" }`.
* localStorage key `notula.summary`: `{ "schema": 1, "appId": "notula", "version": "x.y.z", "lastOpened": "<ISO>", "recent": [ { "id", "title", "updated" } ] }`, newest first. Read-only for Ianua.

## Other storage names (this app only)

* IndexedDB `notula-db`; caches `notula-cache-<version>`; localStorage keys `notula.*` (`notula.lastProject`, `notula.summary`, and `notula.p.<id>`, a short-lived backup copy written when the page closes, or the main copy if IndexedDB is unavailable).
* Shared across the suite and only read: `studio.theme` (`dark`, `gray` or `light`).
