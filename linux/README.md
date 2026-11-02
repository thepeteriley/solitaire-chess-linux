# Solitaire Chess for Debian-based Linux

Installed Electron desktop app with a playable board, local Stockfish evaluation, up to five candidate variations, an adjustable computer opponent, undo, history, board flipping and FEN import. No account, remote engine, or subscription is required. This is the play-and-evaluation app, not the older move-guessing trainer.

Downloads: https://github.com/thepeteriley/solitaire-chess-linux/releases/latest

Source: https://github.com/thepeteriley/solitaire-chess-linux

## Install on your laptop

Download/copy the `.deb` matching your laptop to its Downloads directory. `dpkg --print-architecture` prints `amd64` for normal Intel/AMD laptops or `arm64` for ARM Linux. From that directory:

```sh
sudo apt update
sudo apt install ./solitaire-chess_1.0.0-1_amd64.deb
solitaire-chess
```

For ARM substitute `solitaire-chess_1.0.0-1_arm64.deb`. APT installs the system Stockfish package and required libraries. After installation, launch Solitaire Chess from the desktop's Games menu, or run `solitaire-chess` as your normal user. Do not launch the app with sudo. Installation needs internet access to fetch dependencies; chess play and analysis work offline afterwards.

To remove it: `sudo apt remove solitaire-chess`. Your game/preferences are stored in your user's Electron configuration directory and are not removed with the system package.

The leading `./` is required when installing a downloaded local package. `sudo apt install solitaire-chess` without a file path only works after a distro or configured APT repository publishes it. These builds are not in Debian's official repositories.

## Build

From the source root with Node.js, npm and Python 3 installed:

```sh
npm ci
npm run package:linux
```

Both architectures are produced under `release/linux/`. To build only one after `npm run build`, run `node scripts/package-linux.mjs x64` or `arm64`. Electron's version comes from the installed lockfile-resolved Electron package. The build uses an explicit staging directory so no Apple binary, profile, certificate, mobile code, private App Store notes, or local saved game is included.

Linux uses `/usr/games/stockfish` (or `/usr/bin/stockfish`), supplied by the distro's `stockfish` dependency. `SOLITAIRE_STOCKFISH_PATH` can override this for developer testing. Engine Elo limits are read from that engine's UCI options; Stockfish version and playing strength can vary by distro. The macOS engine path is unchanged.

The `.deb` contains Electron/Chromium and dependency notices. The Chromium sandbox remains enabled; its helper is installed root-owned with mode 4755. Never work around launch failures with `--no-sandbox`. Report the error and distro/kernel information instead.

## Distribution submission

These are locally installable upstream binary packages, not an accepted official Debian source package. A Debian-family distro chooses what it accepts. The Linux edition is licensed under MIT; Stockfish remains a separate GPL-licensed distro package. Public source and build instructions are provided in the Linux GitHub repository. Before submitting, review the target distro's policies with its maintainers. The bundled Electron runtime is a significant policy/maintenance consideration: Debian may require changes to bundled dependencies or a different packaging approach.

See `distro-submission-draft.txt` for a request outline. No request has been sent to distro maintainers.

Debian packaging policy: https://www.debian.org/doc/debian-policy/
Package request process: https://www.debian.org/devel/wnpp/

## Container checks

With Docker available, `sh linux/test-package.sh amd64` or `arm64` installs the package into a fresh Debian 13 image, validates its desktop launcher, runs six engine tests and exercises the installed desktop app in a virtual X display. Pass `ubuntu:24.04` as a second argument for Ubuntu checks. Screenshots are written under `qa/`. These are container checks, not a test of your laptop's graphics hardware or desktop session. The test container gets namespace-related capabilities so Chromium can keep its sandbox; these Docker flags are not required to install or run the app normally.
