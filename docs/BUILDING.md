# Building Framewright

Framewright builds on Windows and macOS. Building needs network access to install packages and download Electron and installer tools. The built app never uses the network.

## Prerequisites

- Node.js 22 or newer (CI uses 24) and npm 11
- Git
- Windows: nothing else. macOS: Xcode Command Line Tools (`xcode-select --install`).

## Setup

```sh
git clone https://github.com/brandondonofrio1998-code/framewright.git
cd framewright
npm ci
```

`npm ci` also downloads the Electron binary. That install script is approved in `package.json` under `allowScripts`.

## Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Starts the app with hot reload |
| `npm run typecheck` | TypeScript, every workspace |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (Vitest) |
| `npm run build` | Production bundle in `apps/desktop/out` |
| `npm run check-offline` | Fails if any runtime code or bundle contains a network URL (run after `build`) |
| `npm run e2e` | Playwright tests against the built app (run after `build`) |
| `npm run verify` | Runs all of the above in order |

To run the end-to-end tests against a packaged app, set `FW_E2E_EXECUTABLE` to its executable, for example
`apps/desktop/release/0.1.0/win-unpacked/Framewright.exe`.

## Installers

Build on the OS you are targeting. A macOS universal build needs a Mac, and the Windows NSIS build is simplest on Windows.

### Windows

```sh
npm run package:win -w @framewright/desktop
```

Output goes to `apps/desktop/release/<version>/`:
- `Framewright-<version>-setup.exe`: an installer that lets you choose the folder. It installs per user and doesn't need admin rights.
- `Framewright-<version>-portable.exe`: runs without installing.

### macOS (universal: Apple Silicon + Intel)

```sh
npm run package:mac -w @framewright/desktop
```

Output: `apps/desktop/release/<version>/Framewright-<version>-universal.dmg`.

## Unsigned builds

These builds are not code-signed, which is fine for personal use. The OS will warn you the first time you open the app.

- **Windows SmartScreen:** "Windows protected your PC". Click **More info**, then **Run anyway**. The warning appears because the publisher is unknown, not because a problem was detected.
- **macOS Gatekeeper:** "Framewright can't be opened because Apple cannot check it for malicious software". Right-click the app in Applications, choose **Open**, then confirm **Open**. On recent macOS versions you may need **System Settings → Privacy & Security → Open Anyway** instead. From a terminal, `xattr -dr com.apple.quarantine /Applications/Framewright.app` does the same thing.

Signing can be added later. Windows needs an Authenticode certificate set through `CSC_LINK` / `CSC_KEY_PASSWORD`. macOS needs an Apple Developer ID plus notarization, by removing `identity: null` and adding notarize settings to `electron-builder.yml`.

## Updates

Help > Allow Update Checks is off in a new install, and the app makes no network requests. Turning it on lets Framewright read the latest GitHub release for this repository and download `Framewright-<version>-setup.exe` on Windows or `Framewright-<version>-universal.dmg` on macOS. On Windows it quits and opens the installer. On macOS it opens the disk image. The installers are unsigned, so the operating system still shows the first-run warning.

## Releases (GitHub Actions)

- `.github/workflows/ci.yml` runs on every push to `main` and on every pull request, on both Windows and macOS. It does a full verify, packages an unpacked app, and runs the end-to-end tests against that packaged app.
- `.github/workflows/release.yml` runs when a `v*` tag is pushed. It checks that the tag matches `apps/desktop/package.json`'s version, builds the Windows installer, the portable exe, and the macOS universal dmg, then attaches them to a **draft** GitHub Release so you can review it before publishing.

```sh
# bump apps/desktop/package.json "version" to 0.2.0, commit, then:
git tag v0.2.0
git push origin v0.2.0
```
