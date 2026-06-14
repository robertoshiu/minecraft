# Self-Hosted Fonts

Place WOFF2 files here. The game will use them automatically once present.
System-ui fallbacks are active until then — no breakage without these files.

## Required files

| File | Source | Notes |
|---|---|---|
| `inter-variable.woff2` | https://rsms.me/inter/ | Variable font, covers weight 100–900 |
| `space-grotesk-500.woff2` | https://fonts.google.com/specimen/Space+Grotesk | Download "Medium 500" |
| `space-grotesk-700.woff2` | https://fonts.google.com/specimen/Space+Grotesk | Download "Bold 700" |
| `jetbrains-mono-400.woff2` | https://www.jetbrains.com/lp/mono/ | Download "Regular 400" |

## Why self-hosted?

The game sets `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` headers for SharedArrayBuffer /
cross-origin isolation. These headers block requests to third-party CDNs
(Google Fonts, rsms.me, etc.) unless the CDN sends a matching
`Cross-Origin-Resource-Policy` header — which most font CDNs do not.
Self-hosting avoids the problem entirely.

## Usage in CSS

Loaded via `src/styles/fonts.css`, imported at the top of `src/styles/hud.css`.
CSS variables defined in `:root`:

```
--font-ui:      'Inter', system-ui, -apple-system, sans-serif
--font-display: 'Space Grotesk', system-ui, sans-serif
--font-mono:    'JetBrains Mono', ui-monospace, monospace
```
