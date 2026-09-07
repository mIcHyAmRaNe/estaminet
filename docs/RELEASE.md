# Release runbook

How to ship a new Estaminet version. Replace `<version>` with the version
being released (e.g. `0.3.0`); the git tag is always `v<version>`.

## How the pieces fit

- **Version source of truth** is `src-tauri/tauri.conf.json` (`version`).
  `package.json` and `src-tauri/Cargo.toml` carry the same number — keep all
  three in sync. The release workflow derives the GitHub Release name from
  the conf file (`tagName: v__VERSION__`), so **the tag must match the conf
  version** or the release will be mislabeled.
- **Tag push is the trigger.** Pushing tag `v<version>` runs
  `.github/workflows/release.yml`, which builds the Linux `.deb`
  (ubuntu-22.04) and the Windows NSIS `-setup.exe` (windows-latest) and
  **publishes the GitHub Release immediately** (`releaseDraft: false`).
  Immediate publish is deliberate: the in-app updater reads
  `.../releases/latest/download/latest.json`, which 404s while a release is
  still a draft — a draft would silently break update checks for everyone.
- **No paid code signing.** The Windows installer is unsigned (SmartScreen
  will warn). Instead each build leg attaches a **build-provenance
  attestation** plus a `SHA256SUMS-<platform>` file, so users can verify a
  binary was produced by this repo's CI and not tampered with:
  `gh attestation verify <file> -R mIcHyAmRaNe/estaminet`.
- **Auto-update signing is separate.** Update artifacts (`latest.json` +
  `.sig` files) are signed with our own minisign keypair (free, generated
  once — see below), not with a Windows certificate. The public key lives in
  `tauri.conf.json` (`plugins.updater.pubkey`); the app refuses updates that
  don't verify against it.

## One-time setup: updater signing key

Done once per maintainer machine (or whenever the key is rotated). The
private key signs update artifacts in CI; the password protects the key.

```bash
mkdir -p ~/.tauri
export TAURI_KEY_PASS="$(openssl rand -base64 24)"
bunx tauri signer generate -w ~/.tauri/estaminet.key --password "$TAURI_KEY_PASS" --ci
```

What this gives you:

| File | Contents | Where it goes |
|---|---|---|
| `~/.tauri/estaminet.key.pub` | public key (safe to share) | paste into `tauri.conf.json` → `plugins.updater.pubkey`, commit it |
| `~/.tauri/estaminet.key` | **private key — secret** | GitHub secret `TAURI_SIGNING_PRIVATE_KEY` (file contents), then back up offline |
| `$TAURI_KEY_PASS` | **key password — secret** | GitHub secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, then destroy |

Add the secrets at GitHub → `mIcHyAmRaNe/estaminet` → Settings → Secrets
and variables → Actions (or `gh secret set <NAME> < file`):

- `TAURI_SIGNING_PRIVATE_KEY` ← contents of `~/.tauri/estaminet.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` ← the generated password

Afterwards, delete any temp password file (`shred -u` it) and **back up
`~/.tauri/estaminet.key` offline** (password manager, USB stick, …).
Losing the private key or its password means future releases can't produce
updates the installed apps will accept — recovery requires shipping a new
public key inside a manually-installed build.

## Releasing a version

```bash
# 1. Bump the version in all three files to <version>:
#      package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json
# 2. Move CHANGELOG.md entries from "Unreleased" under "## <version>".
git add -A && git commit -m "Release <version>"

# 3. Push, tag (tag MUST equal the conf version), push the tag:
git push origin main
git tag v<version>
git push origin v<version>
```

Then watch Actions → Release workflow, and check the published release:

- Assets: `.deb`, `-setup.exe`, `.sig` files, `latest.json`,
  `SHA256SUMS-*` — all present.
- Provenance: download an installer and run
  `gh attestation verify <file> -R mIcHyAmRaNe/estaminet`.
- Updater: an installed older version should offer `<version>` via its
  update banner shortly after publish.
