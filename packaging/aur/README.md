# Arch Linux packaging

`PKGBUILD` defines the `cordflow-git` VCS package intended for the Arch User
Repository. It builds the latest Git revision and declares `cordflow` in
`provides` and `conflicts`.

From the repository root, build an installable package from the current working
tree with:

```sh
pnpm build:arch
```

The local package is written to
`src-tauri/target/release/bundle/arch/cordflow-<version>-<release>-x86_64.pkg.tar.zst`.
Install it with:

```sh
sudo pacman -U src-tauri/target/release/bundle/arch/cordflow-*.pkg.tar.zst
```

Before publishing `packaging/aur/` to the AUR, regenerate `.SRCINFO`:

```sh
cd packaging/aur
makepkg --printsrcinfo > .SRCINFO
```
