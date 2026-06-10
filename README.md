# HTML to Figma

A Figma plugin that imports any webpage as fully editable Figma frames — preserving layout, typography, colors, images, and effects.

## Features

- **URL import** — paste any public URL and convert it directly into Figma layers
- **Editable output** — generates native Figma frames, text nodes, images, and SVGs (not flattened screenshots)
- **Rich CSS support** — backgrounds, gradients, box shadows, border radius, opacity, blend modes, and backdrop blur
- **Auto-layout** — detects flexbox containers and maps them to Figma auto-layout
- **Typography** — preserves font family, size, weight, line height, letter spacing, and text decoration
- **Images & SVGs** — embeds raster images as fills and inline SVGs as vector nodes
- **CORS proxy** — bundled proxy handles cross-origin pages that can't be fetched directly
- **Progress feedback** — real-time status updates while the design tree is being built

## Installation

1. Open Figma → **Plugins → Development → Import plugin from manifest**
2. Select the `manifest.json` file from this repo

## Limitations

- Pages behind authentication or bot-protection may not import correctly
- Some complex CSS (3D transforms, `clip-path`, CSS Grid) is approximated
- Web fonts not loaded in the plugin iframe may fall back to system fonts in Figma

## License

**All Rights Reserved.** This source code is published for reference and transparency only. Copying, redistributing, or publishing this plugin (or any derivative) to the Figma Plugin Community or any other platform is strictly prohibited without explicit written permission. See [LICENSE](./LICENSE) for full terms.
