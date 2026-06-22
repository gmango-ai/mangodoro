# Installing the Mangodoro desktop app

Download the installer for your platform from the [Releases page](../../releases):

| Platform | File |
| --- | --- |
| macOS | `Mangodoro-<version>.dmg` |
| Windows | `Mangodoro Setup <version>.exe` |
| Linux | `Mangodoro-<version>.AppImage` |

---

## macOS: "Mangodoro is damaged" / "cannot be opened" on first launch

The macOS build is **not signed with an Apple Developer certificate and is not
notarized** (that requires a paid Apple Developer account). Because of this,
macOS Gatekeeper blocks it the first time you open it, with one of:

- **"Mangodoro is damaged and can't be opened. You should move it to the Trash."** (most common on Apple Silicon)
- **"Mangodoro can't be opened because the developer cannot be verified."**

**The app is not actually damaged** — macOS just refuses to run unsigned apps it
downloaded from the internet until you tell it to trust this one. You only have
to do this **once**; updates from inside the app afterward run normally.

### Recommended: remove the quarantine flag (works on every macOS, including Sequoia)

1. Open the `.dmg` and drag **Mangodoro** into your **Applications** folder.
2. Open **Terminal** (Applications → Utilities → Terminal) and run:

   ```bash
   xattr -dr com.apple.quarantine /Applications/Mangodoro.app
   ```

3. Open **Mangodoro** from Applications as usual.

That command strips the "downloaded from the internet" quarantine attribute that
triggers the **"damaged"** message. It does not modify the app itself.

### Alternative: Open Anyway via System Settings

Use this if you saw **"developer cannot be verified"** (it does **not** clear the
**"damaged"** message — for that, use the Terminal method above):

1. Try to open **Mangodoro** once and dismiss the warning.
2. Go to  **System Settings → Privacy & Security**.
3. Scroll to the **Security** section — you'll see *"Mangodoro was blocked from use."*
   Click **Open Anyway**.
4. Confirm with Touch ID or your password, then open the app again.

### Alternative: right-click → Open (older macOS / Intel)

1. In **Applications**, **Control-click** (or right-click) **Mangodoro** and choose **Open**.
2. Click **Open** in the dialog.

> On macOS Sequoia (15) and later this shortcut no longer bypasses Gatekeeper for
> unsigned apps — use the Terminal method instead.

---

## Windows: "Windows protected your PC" (SmartScreen)

The Windows installer is unsigned, so SmartScreen shows a blue warning:

1. Click **More info**.
2. Click **Run anyway**.

---

## Linux

Make the AppImage executable, then run it:

```bash
chmod +x Mangodoro-<version>.AppImage
./Mangodoro-<version>.AppImage
```

---

## Why isn't it signed?

Signing + notarizing macOS apps and code-signing Windows installers both require
paid developer certificates. Until those are set up, the desktop builds ship
unsigned. The installers are built in CI directly from this repository — see
[`.github/workflows/release-electron.yml`](../.github/workflows/release-electron.yml).
