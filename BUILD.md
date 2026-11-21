# Build Instructions

Install [node.js](https://nodejs.org/) and [npm](https://www.npmjs.com/) for your operating system.

Grab a copy of the source code and install the dependencies:

```sh
git clone https://github.com/StephenGenusa/passphrases.git
cd passphrases
npm install
```

To run the app while developing:

```sh
npm start
```

To run the end-to-end check, which starts the app and drives the window:

```sh
npm test
```

The app runs on [Electron](https://www.electronjs.org/). `src/main.js` is the main process, `src/preload.js` is the bridge to the page, and the page itself (`src/index.html` and `src/js`) runs sandboxed with no access to Node.

## Building and packaging

`build.js` builds the app for the platform it is run on. It needs nothing beyond Node and the Electron that `npm install` already fetched: the app is Electron's own distribution with `src/` placed in its `resources/app` folder.

```sh
npm run build      # the app, in build/
npm run package    # also installers and archives, in dist/
```

Packaging uses the platform's own tools, and a tool that is not installed is skipped with a message. The architecture is that of the installed Electron; to build for another one, install Electron for it first, for example `npm_config_arch=arm64 npm ci`.

| Platform | Output | Tool |
|---|---|---|
| Linux | `.tar.gz` | `tar` |
| Linux | `.deb` | `dpkg-deb` |
| Linux | `.rpm` | `rpmbuild` |
| Linux | `.AppImage` | [appimagetool](https://github.com/AppImage/appimagetool), on the `PATH` or named by the `APPIMAGETOOL` variable |
| macOS | `Passphrases.app`, `.zip`, `.dmg` | `ditto`, `codesign`, `hdiutil` |
| Windows | app folder, `.zip` | `tar` (the one in `System32`) |
| Windows | `-Setup.exe` | `makensis` from [NSIS](https://nsis.sourceforge.io/) |
| Windows | icon and version details of `Passphrases.exe` | [rcedit](https://github.com/electron/rcedit) |

What has been run:

* **Linux `.tar.gz` and `.deb`:** built and checked on Ubuntu x64; the packaged app starts.
* **Everything else:** written but not yet run. The first GitHub Actions run is their first test.

### Continuous integration

`.github/workflows/build.yml` runs on every push to `master`, on pull requests, and on tags.

1. It runs `npm test` on Linux, Windows and macOS.
2. It builds the packages above for Linux x64 and arm64, Windows x64 and arm64, and macOS arm64 and x64, and keeps them as build artifacts.
3. On a tag that starts with `v`, it collects them into a **draft** release with a `SHA256SUMS.txt`. Nothing is public until you publish the draft.

To cut a release, set the version in `package.json`, then:

```sh
git tag v0.2.0
git push origin v0.2.0
```

Every action is pinned to a commit. The two downloaded tools, appimagetool 1.9.1 and rcedit 2.0.0, are checked against SHA-256 checksums written in the workflow; update the checksums when you change a version.

There is no 32-bit Windows build because Electron no longer publishes one.

### Signing

Nothing is signed with a certificate.

* **macOS.** The app gets an ad-hoc signature so that it runs on Apple silicon, but Gatekeeper still warns about apps downloaded from the Internet. To remove the warning, sign with your own Developer ID certificate (with the hardened runtime) and notarize:

  ```sh
  codesign --force --deep --options runtime --sign "Developer ID Application: YOUR NAME" build/Passphrases-darwin-arm64/Passphrases.app
  xcrun notarytool submit dist/Passphrases-VERSION-mac-arm64.zip --keychain-profile YOUR_PROFILE --wait
  ```

* **Windows.** Sign `Passphrases.exe` and the installer with your own code signing certificate using `signtool`.

### Notes

* The Linux packages install to `/opt/Passphrases` with a launcher at `/usr/bin/passphrases`, a desktop entry and icons.
* An AppImage cannot carry a setuid sandbox helper. On systems that restrict unprivileged user namespaces, such as Ubuntu 24.04 with its default AppArmor policy, the AppImage may refuse to start; the `.deb` does not have this problem.
* On macOS the bundle is named Passphrases, but its executable and helper processes keep Electron's names, so Activity Monitor shows "Electron".

## Icon

`packaging/icon.svg` is the source of every icon file. After changing it, regenerate the PNG files with `rsvg-convert` (from librsvg), for example:

```sh
rsvg-convert -w 256 packaging/icon.svg -o packaging/passphrases-256.png
```

The files made from it are `logo.png`, `src/images/icon.png` (256 px), `packaging/passphrases-64.png`, `-256.png` and `-512.png`, `packaging/icon.ico` (16 to 256 px) and `packaging/icon.icns` (128 to 1024 px).

## Wordlists

The lists in `src/wordlists` and the `manifest.json` the app reads are written by `tools/build_wordlists.py` (Python 3, standard library only). The Wiktionary lists come from the [Kaikki.org](https://kaikki.org/dictionary/rawdata.html) extract of the English Wiktionary.

```sh
mkdir -p cache/kaikki
curl -L -o cache/kaikki/raw-wiktextract-data.jsonl.gz https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz
python3 tools/build_wordlists.py extract
python3 tools/build_wordlists.py build --min-words 2048
```

The download is about 3 GB. `extract` reduces it to `cache/kaikki/entries.tsv`; `build` applies the filters, removes every word in `tools/blocklist.txt` (the single slur and vulgarity list, all languages) from every list, and drops any list with fewer than `--min-words` words.
