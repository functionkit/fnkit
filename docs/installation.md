# Installation

## From Binary

Download the pre-built binary for your platform from the [releases page](https://github.com/functionkit/fnkit/releases).

### macOS

```bash
# Apple Silicon (M1/M2/M3/M4)
curl -L https://github.com/functionkit/fnkit/releases/latest/download/fnkit-macos-arm64 -o fnkit
chmod +x fnkit && ./fnkit install

# Intel
curl -L https://github.com/functionkit/fnkit/releases/latest/download/fnkit-macos-x64 -o fnkit
chmod +x fnkit && ./fnkit install
```

### Linux

```bash
# x64
curl -L https://github.com/functionkit/fnkit/releases/latest/download/fnkit-linux-x64 -o fnkit
chmod +x fnkit && ./fnkit install

# ARM64
curl -L https://github.com/functionkit/fnkit/releases/latest/download/fnkit-linux-arm64 -o fnkit
chmod +x fnkit && ./fnkit install
```

### Windows

```powershell
# PowerShell (as Administrator)
Invoke-WebRequest -Uri https://github.com/functionkit/fnkit/releases/latest/download/fnkit-windows-x64.exe -OutFile fnkit.exe
.\fnkit.exe install
```

The `install` command copies the binary to `/usr/local/bin/fnkit` (or the equivalent on Windows) so it's available globally.

## From Source

Requires [Bun](https://bun.sh) to be installed.

```bash
git clone https://github.com/functionkit/fnkit.git
cd fnkit
bun install
bun run build
# Binary is now at ./dist/fnkit
```

### Build for All Platforms

```bash
bun run build:all
# Outputs:
#   dist/fnkit-macos-arm64
#   dist/fnkit-linux-x64
#   dist/fnkit-windows-x64.exe
```

## Uninstall

```bash
fnkit uninstall
```

This removes the binary from `/usr/local/bin`.

## Verify Installation

```bash
fnkit --version
fnkit doctor        # Check all runtime dependencies
fnkit doctor node   # Check a specific runtime
```

---

← [Back to README](../README.md)
