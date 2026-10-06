# No Kapu Tuner

A sleek guitar, ukulele and chromatic tuner that works offline. No ads, no extras.
("No Kapu" is two words; here it means no frills.)

## What's in it

- **Guitar** (E A D G B E), **Ukulele** (G C E A), and **Chromatic** modes.
- Auto-detects which string you're playing. Tap a string to lock to it; tap again to unlock.
- Needle runs ±50 cents, with a "Tune up / Tune down / In tune" hint.
- Settings (the ⋯ button): **Theme** (Default or Tuna) and **Reference pitch** (A = 415–466 Hz, default 440).
- **Tuna** theme: ahi-inspired palette, and the word "Tuner" becomes "Tuna".
- The name only appears, small, on the opening screen.
- Keeps the screen awake while tuning (where the browser allows it).

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The whole app: screens, styles, UI logic |
| `tuner-core.js` | Pitch detection (YIN) and note math, no dependencies |
| `sw.js` | Service worker: caches everything for offline use |
| `manifest.webmanifest` | Lets it install to the home screen |
| `icons/` | App icons |
| `test/core.test.js` | Tests for the pitch detection and note math |
| `test/ui.smoke.test.js` | Runs the app's script against a fake browser and a synthetic mic |

## Run it

The microphone only works on `https://` pages or on `localhost`.

```sh
python3 -m http.server 8080
# then open http://localhost:8080
```

To use it on a phone, host these files anywhere that serves HTTPS (any static host works), open the page once online, then use **Add to Home Screen**. After the first load it runs offline.

## Test

```sh
node test/core.test.js
node test/ui.smoke.test.js
```

## Changing the app

When you change any cached file, bump `CACHE` in `sw.js` (for example `nokapu-v2`) so installed copies pick up the update.
