<p align="center"><img src="logo.png" width="128" alt="Passphrases icon: a key whose bow is a die and whose blade is three words"></p>

# Passphrases

[![Build](https://github.com/StephenGenusa/passphrases/actions/workflows/build.yml/badge.svg)](https://github.com/StephenGenusa/passphrases/actions/workflows/build.yml)
[![Latest release](https://img.shields.io/github/v/release/StephenGenusa/passphrases?include_prereleases&label=release)](https://github.com/StephenGenusa/passphrases/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE.md)
![Electron 45](https://img.shields.io/badge/Electron-45-47848f?logo=electron&logoColor=white)
![Runtime dependencies: 0](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen)
![Platforms: Linux, Windows, macOS](https://img.shields.io/badge/platforms-Linux%20%7C%20Windows%20%7C%20macOS-lightgrey)
![261 word lists](https://img.shields.io/badge/word%20lists-261-informational)
![137 languages](https://img.shields.io/badge/languages-137-informational)

A desktop tool that generates high-entropy passphrases and helps you memorize them with spaced repetition.

<p align="center">
  <img src="screenshots/generate.png" width="420" alt="The Generate tab with the default options">
  <img src="screenshots/word-lists.png" width="420" alt="The Word lists tab, grouped by language">
</p>
<p align="center">
  <img src="screenshots/memorize.png" width="420" alt="The Memorize tab part way through a try">
  <img src="screenshots/low-contrast.png" width="420" alt="The Generate tab in a low-contrast color style">
</p>

## Features

- **Random where it counts.** Words are drawn with the operating system's cryptographic random number generator, with no modulo bias.
- **261 word lists in 137 languages.** They are built from Wiktionary, plus the EFF, Diceware, EOWL and SecureDrop lists. The Word lists tab groups them by language with English first, and typing narrows them down.
- **Mix lists.** Switch on more than one and passphrases are drawn from all of them combined.
- **Clean lists.** A single list of 22,104 slurs and vulgar words, covering all languages, is filtered out of every list.
- **A maximum length that is honoured exactly.** Every passphrase that fits is equally likely, and the entropy shown is the real figure for that limit.
- **Made for sites with password rules.** Capital letters, numbers and symbols are each a checkbox, and every kind that is on appears at least twice. The symbols come from a field you can edit to match what a site accepts; it starts with the commonly accepted ones.
- **ASCII words only, by default.** Words with accented or non-Latin letters are left out unless you switch that off, because many sites mishandle them.
- **Fourteen color styles.** They include low-contrast ones that draw the passphrase at about 3:1 contrast, readable at the keyboard and hard to read from across a room.
- **A copy button that cleans up after itself.** The passphrase is put on the clipboard with the markers password managers use, so Windows clipboard history, cloud clipboard sync and clipboard managers skip it. The app clears it from the clipboard after 30 seconds, unless you have copied something else by then. Closing the window does not cancel the clearing.
- **Hide and show.** One button turns the passphrase into dots, and the choice is remembered.
- **Hard to misread.** The passphrase is set in JetBrains Mono, which keeps l, I and 1 and O and 0 apart, and digits and symbols each have their own color. The font ships inside the app.
- **Works from the keyboard.** Every button and tab can be reached with Tab and the arrow keys, and is labelled for screen readers.
- **Private.** Nothing is saved except the sound, color and hide settings. The main process cancels every network request, so nothing is sent over the Internet.

## Download

Installers are built by GitHub Actions and attached to each [release](https://github.com/StephenGenusa/passphrases/releases).

| Platform | Files |
|---|---|
| Linux x64 and arm64 | `.AppImage`, `.deb`, `.rpm`, `.tar.gz` |
| Windows x64 (win64) and arm64 | `-Setup.exe` installer, portable `.zip` |
| macOS Apple silicon and Intel | `.dmg`, `.zip` |

- **No 32-bit Windows build.** Electron no longer ships one, so win32 is not available.
- **The installers are not code signed.** Windows SmartScreen and macOS Gatekeeper will warn before the first run. On macOS, right-click the app and choose Open.
- **Checksums.** Each release includes `SHA256SUMS.txt`.

## No dependencies beyond Electron

The app ships with **zero npm packages**. Everything on the page is plain HTML, CSS and JavaScript, about 1,100 lines in all.

- **jQuery was removed.** The original app used jQuery 2.1. It was replaced by the browser's own DOM calls and two small helper functions in `src/js/common.js`: `el()` finds an element and `setVisible()` shows or hides it. No library took its place.
- **random-js was removed.** Its default engine was `Math.random`, which is not suitable for secrets. A short function over `crypto.getRandomValues` replaced it.
- **Two fonts are bundled as files.** Open Sans for the interface and JetBrains Mono Bold for the passphrase, both under open licences kept beside them in `src/fonts`. They are loaded from disk, never from the network.
- **Electron is the only development dependency.** It brings 12 small packages used to download and unpack it; none of them is in the packaged app. `package-lock.json` pins every version.
- **No build framework.** `build.js` packages the app with Node and each platform's own tools. In CI, two extra tools are downloaded (appimagetool and rcedit), each pinned to a version and checked against a SHA-256 checksum, and every GitHub Action is pinned to a commit.

## How it works

### Architecture

The page runs in Chromium's sandbox with no access to Node or the file system. It reaches the rest of the system only through seven calls that the preload script exposes.

```mermaid
flowchart LR
    subgraph Renderer["Page (sandboxed, no Node)"]
        UI["index.html<br/>generate, memorize, tabs, about"]
    end
    subgraph Bridge["preload.js"]
        API["window.passphrasesApp<br/>7 calls"]
    end
    subgraph Main["main.js (main process)"]
        IPC["IPC handlers"]
    end
    UI --> API --> IPC
    IPC --> WL[("wordlists/<br/>manifest.json + 261 lists")]
    IPC --> PREFS[("passphrases.conf<br/>sound, color style, hide")]
    IPC --> CLIP["clipboard<br/>marked sensitive, cleared after 30 s"]
    IPC --> BROWSER["system browser<br/>https links only"]
```

A Content-Security-Policy allows only the app's own files, the main process cancels any request that is not for one of those files, and the page asks for a word list by id; the file name always comes from the manifest in the main process.

### Generating a passphrase

```mermaid
flowchart TD
    A["Options: lists, word count, capitals,<br/>numbers, symbols, maximum length"] --> B["Count the word combinations<br/>that fit the maximum length"]
    B -->|none fit| C["Say so; no passphrase"]
    B -->|some fit| D["Pick each word's length in proportion<br/>to the ways the rest can still fit"]
    D --> E["Pick a word of that length"]
    E -->|more words| D
    E -->|done| F["Add capitals, numbers and symbols:<br/>at least two of each kind that is on"]
    F --> G["Show the passphrase, its length<br/>and its entropy"]
    R(["crypto.getRandomValues"]) -.-> D
    R -.-> E
    R -.-> F
```

Counting first is what makes every fitting passphrase equally likely, and the logarithm of that count is the entropy the app displays.

### Memorizing

```mermaid
stateDiagram-v2
    [*] --> Typing: start with a passphrase
    Typing --> Typing: typed correctly, hint delay grows
    Typing --> Resting: 10 tries, last one typed before the hint
    Resting --> Ready: countdown ends or Skip
    Ready --> Typing: space bar
    Typing --> [*]: Cancel
    Resting --> [*]: Cancel
    Ready --> [*]: Cancel
```

The hint appears later on each try, the field turns into a password field after five tries, and the rests grow from one minute to an hour. A notification says when a rest is over.

### Building the word lists

```mermaid
flowchart LR
    K["Kaikki.org extract of<br/>English Wiktionary<br/>11.1 million entries"] --> X["extract<br/>entries.tsv"]
    X --> F["Filter: headwords only,<br/>letters only, 3 to 30 characters"]
    BL["tools/blocklist.txt<br/>22,104 words"] --> F
    O["EFF, Diceware, EOWL,<br/>SecureDrop lists"] --> N["Normalize, deduplicate"]
    BL --> N
    F --> T{"At least<br/>2,048 words?"}
    T -->|yes| OUT["src/wordlists/<br/>+ manifest.json"]
    T -->|no| DROP["dropped"]
    N --> OUT
```

### Continuous integration

```mermaid
flowchart LR
    P["push, pull request<br/>or tag"] --> T["Test<br/>Linux, Windows, macOS"]
    T --> L["Package Linux<br/>x64, arm64"]
    T --> W["Package Windows<br/>x64, arm64"]
    T --> M["Package macOS<br/>arm64, x64"]
    L --> A["Build artifacts"]
    W --> A
    M --> A
    A -->|tag v*| R["Draft release<br/>+ SHA256SUMS.txt"]
```

## Run from source

```sh
git clone https://github.com/StephenGenusa/passphrases.git
cd passphrases
npm install
npm start
```

`npm test` starts the app and drives the window end to end. See [BUILD.md](BUILD.md) for packaging, the icon and rebuilding the word lists.

## Credits and license

Passphrases is a fork of [micahflee/passphrases](https://github.com/micahflee/passphrases) by Micah Lee, released under the [MIT license](LICENSE.md).

Word lists: [Wiktionary](https://www.wiktionary.org/) via [Kaikki.org](https://kaikki.org/) (CC BY-SA), the [EFF wordlists](https://www.eff.org/dice) (CC BY 4.0), the Diceware lists and their translators, the English Open Word List, and SecureDrop. The blocklist draws on [LDNOOBW](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words) (CC BY 4.0). Color palettes: Solarized, Nord, Gruvbox, Dracula and Zenburn.
