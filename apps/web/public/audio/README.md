# BGM tracks

Hosted vocal BGM playlist for the shared fx audio engine. The manifest is
`playlist.json` (`{ tracks: [{ src, title, artist, license, creditUrl }] }`);
the app loads it at boot and falls back to the procedural Web Audio soundtrack
when the manifest or a track is unavailable.

Tracks are used under the Pixabay Content License (free for commercial use,
no attribution required). Not for standalone redistribution.

Provenance details per track: see `docs/AUDIO-ASSETS.md`.
