# Immich for older Samsung TVs (Tizen)

A small, remote-friendly [Immich](https://immich.app) app for Samsung Smart TVs. Browse your timeline, albums, people and
"On this day" memories, watch videos, and run slideshows with Ken Burns motion and shuffle, all with the regular TV
remote. It is built for **older** Samsung TVs whose built-in browser is too old for the Immich web app.

> **Unofficial.** This is a community project. It is not affiliated with, endorsed by, or supported by the Immich
> project or FUTO. "Immich" is used only to describe what the app connects to.

<p align="center"><img src="app/icon.png" width="256" alt="App icon"></p>

## Features

- **Home screen rows:** On this day, Recent (plus an "All Photos" entry), Albums, People.
- **Photo grids** for the whole timeline, any album, any person or any memory. They stay fast with tens of thousands of
  photos, because only the visible thumbnails exist on screen and each month is fetched only when you scroll to it.
- **Full-screen viewer:** previous/next with the arrows, a details panel (date, place, camera, exposure, people,
  file name), and video playback with play/pause and 10-second skips.
- **Slideshow and Shuffle buttons** on every grid. Shuffle randomises the *whole* album, person or timeline, not
  just the photos already loaded.
- **Slideshow polish:**
  - Ken Burns zoom and pan, in a random direction each photo.
  - Smooth crossfades.
  - The next two photos are preloaded, so there's no loading spinner between slides.
  - Photos that aren't 16:9 (portrait shots, for example) sit on a blurred, darkened copy of themselves instead of
    black bars.
- **No build step, no frameworks.** It's plain JavaScript and CSS written for the TV's old browser engine.

## Why this exists

Samsung TVs from roughly 2017 to 2021 run Tizen 3 to 6, with a web engine based on an old Chromium (Tizen 5.0 is
Chromium 63, from 2018). The Immich web app needs a modern browser, and a Tizen app runs in that same old engine, so
wrapping the website in an app doesn't help. The other Tizen Immich viewer I know of needs Tizen 7 or newer. This
app is written for the old engine from the start.

## Compatibility

| | |
|---|---|
| **Tested** | 2019 Samsung RU7400 series, Tizen 5.0 (Chromium 63) |
| **Should work** | Other Samsung TVs on Tizen 3.0–6.x (2017–2021), and newer ones. Untested: reports welcome |
| **Immich** | Tested against server v2.4.x. It uses only a few read-only endpoints, but a major Immich release could change them |
| **Install machine** | **x86-64** Linux with Docker (a home server, a VM, a NAS that runs Docker), or Windows WSL2 with mirrored networking. Not ARM (Samsung's CLI is x86-64 only, so no Raspberry Pi), and not Docker Desktop on Mac/Windows, which lacks the host networking this needs |

## Remote controls

| Where | Button | Does |
|---|---|---|
| Everywhere | Arrows / OK / Back | Move / open / go back (Back on Home exits) |
| Grid | Slideshow / Shuffle buttons (top) | Focus starts here; OK starts a slideshow. Down moves into the photos |
| Grid | Channel + / − | Jump three rows |
| Grid | Play | Slideshow from the selected photo |
| Viewer | Left / Right | Previous / next |
| Viewer | Up, Down or OK | Show or hide photo details |
| Viewer | Play/Pause | Start / stop the slideshow (6 s per photo; videos play to the end) |
| Video | OK or Play/Pause | Play / pause |
| Video | Fast-forward / Rewind | Skip 10 s |

## Setup

You need about 20 minutes, and you do steps 1–3 only once. Everything below happens on your **install machine**: the
Linux/Docker box on the same network as the TV.

### 1. Create a read-only Immich API key

In Immich: **Account Settings > API Keys > New API Key**. Name it something like "Samsung TV" and give it **only**
these permissions:

`asset.read`, `asset.view`, `asset.download`, `album.read`, `timeline.read`, `person.read`, `memory.read`,
`partner.read`, `user.read`, `server.about`

Save the key in a file on the install machine (not in this repo):

```bash
mkdir -p ~/.secrets && nano ~/.secrets/immich-tv-key   # paste the key, save
chmod 600 ~/.secrets/immich-tv-key
```

### 2. Get the code and configure it

```bash
git clone https://github.com/yoheiocean/immich-tizen-app.git
cd immich-tizen-app
cp .env.example .env
nano .env        # set TV_IP and IMMICH_URL (and optionally ICON_FROM_SERVER=1)
```

`IMMICH_URL` must be an address the **TV** can reach, usually your server's LAN IP and port, like
`http://192.168.1.20:2283`.

### 3. Turn on Developer Mode on the TV

1. Find your install machine's LAN IP (`hostname -I`).
2. On the TV, open **Apps** from the Home bar.
3. **Highlight any app tile** so it is selected. This matters: with nothing selected, the code below does nothing.
4. Type **1 2 3 4 5** on the remote. On remotes without number keys, use the **123** button's on-screen keypad.
5. In the Developer Mode window, switch it **On** and set **Host PC IP** to your install machine's IP. Choose OK.
6. **Hold the power button** until the TV restarts. A normal off/on is not enough.

The TV accepts installs **only** from that one IP. If you later install from another machine, change it the same way.

### 4. Build the tools, sign, install

```bash
bash tools/tv.sh build-image   # Samsung's official Tizen CLI in a container (one time, a few minutes)
bash tools/tv.sh connect       # should print your TV's model and "platform_version"
bash tools/tv.sh cert          # creates your signing certificate in ~/.tizen-data (one time)
bash tools/tv.sh install       # packages, installs and launches the app (a few seconds)
```

The app now appears in the TV's **Apps** panel as "Immich".

### Updating

```bash
git pull && bash tools/tv.sh install
```

Keep `~/.tizen-data`. The TV only accepts updates signed with the same certificate. If you lose it, run
`bash tools/tv.sh uninstall`, then `cert` and `install` again.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `12345` on the Apps screen does nothing | Highlight an app tile first, then type the code |
| `failed to connect to <TV>:26101` | Developer Mode is off, or **Host PC IP** isn't this machine's IP. Check it in the Developer Mode window, then hold Power to restart the TV |
| `Invaild password` when packaging | The signing profile lost its passwords: run `bash tools/tv.sh cert` again |
| App opens but shows "Could not reach Immich" | `IMMICH_URL` isn't reachable *from the TV*. Use the LAN IP, not `localhost`. Check the server's port |
| Some videos say they can't be played | The TV can't decode that file and Immich has no transcoded copy. Set Immich's video transcoding policy so it creates H.264 versions |
| Install works but the icon didn't change | The TV caches icons; restart the TV |

## How it works (for the curious)

- **No build step.** `app/` is the whole app: `index.html`, `css/app.css`, `js/api.js`, `js/app.js`. At package time,
  `tools/tv.sh` writes `js/config.js` (server URL + API key) into a temporary copy only, so the key never touches the
  repo.
- **The old engine.** The code avoids anything newer than about 2018, including optional chaining, `??`,
  `Array.flat`, flexbox `gap`, `aspect-ratio`, `inset`, and `img.decode()`. Check before committing:
  `npx -y acorn@8.14.0 --ecma2017 --silent app/js/*.js`.
- **Auth for images.** `<img>` and `<video>` can't send headers, so media URLs use Immich's `?apiKey=` query
  parameter. JSON requests use the `x-api-key` header. (`?key=` is for shared links and won't work.)
- **Endpoints:**
  - `timeline/buckets`: monthly counts, used to size grids before any photos load.
  - `timeline/bucket`: one month's assets, returned as columns.
  - `albums`, `people`, `memories`, `assets/{id}`.
  - `assets/{id}/thumbnail?size=thumbnail|preview` and `assets/{id}/video/playback`.
- **Blurred background.** A CSS `filter: blur()` on a hidden layer is only drawn when the layer becomes visible, which
  shows up as a flash of black bars. Instead, each photo's thumbnail is blurred into a 120×68 `<canvas>` *before* the
  slide changes, and the canvas is scaled up on the GPU.
- **Packaging.** It uses Samsung's official CLI installer (`download.tizen.org`), not a third-party image.
  `tizen build-web` is skipped because it crashes in CLI 6.1 and is only an optional minify step.

## Security notes

- The API key is built into the app installed on your TV. Give it read-only permissions as listed above, and revoke it
  in Immich if the TV ever leaves your home.
- The app talks to Immich over your LAN (usually plain HTTP). Don't point it at a public URL over HTTP.
- The signing certificate and its password stay in `~/.tizen-data` on the install machine (mode 600).

## Limitations

- Shows the API key owner's library. Partner-shared photos don't appear in the timeline.
- No search, map, editing, uploads, favourites or live-photo motion. It's a viewer.
- One server per build. To use another server, change `.env` and reinstall.

## Contributing

Issues and pull requests are welcome, especially test reports from other TV years and models (please include the
`platform_version` that `tools/tv.sh connect` prints). Keep everything runnable on the old engine.

## Acknowledgements

- [Immich](https://github.com/immich-app/immich), the self-hosted photo server this app is a viewer for.
- The Jellyfin Tizen community, whose install-from-Docker approach inspired the tooling here.

## License

MIT. See [LICENSE](LICENSE).
