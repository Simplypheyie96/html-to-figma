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

> The plugin requires `code.js` (compiled from `code.ts`) to be present alongside `manifest.json` and `ui.html`.

## Development

**Prerequisites:** Node.js, TypeScript

```bash
# Install TypeScript globally if needed
npm install -g typescript

# Compile the plugin
tsc code.ts --target es6 --lib es6,dom --outFile code.js
```

Then reload the plugin in Figma after each build.

## Project Structure

```
html-to-figma/
├── manifest.json   # Figma plugin manifest
├── code.ts         # Main thread — builds Figma nodes from the design tree
├── ui.html         # Plugin UI — captures page DOM and sends design data
└── proxy/          # CORS proxy for fetching cross-origin pages
```

## How It Works

1. **UI thread** (`ui.html`) — runs in an iframe with access to the browser. It fetches the target URL (via the CORS proxy if needed), walks the live DOM using `getComputedStyle`, and serializes the visual tree into a `DesignNode` JSON structure.
2. **Main thread** (`code.ts`) — receives the `DesignNode` tree from the UI and recursively creates Figma nodes: `FrameNode`, `TextNode`, `RectangleNode`, and image fills. Auto-layout, shadows, gradients, and blend modes are applied at this stage.

## Limitations

- Pages behind authentication or bot-protection may not import correctly
- Some complex CSS (3D transforms, `clip-path`, CSS Grid) is approximated
- Web fonts not loaded in the plugin iframe may fall back to system fonts in Figma

## License

**All Rights Reserved.** This source code is published for reference and transparency only. Copying, redistributing, or publishing this plugin (or any derivative) to the Figma Plugin Community or any other platform is strictly prohibited without explicit written permission. See [LICENSE](./LICENSE) for full terms.
