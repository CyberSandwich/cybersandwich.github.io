# CodeGen

QR code and barcode generation suite. Fast, private, local-only.

## Features

- **QR Code Generation** - Create QR codes with customizable colors and error correction
- **Barcode Generation** - Support for CODE128, EAN-13, EAN-8, UPC-A, CODE39, ITF-14, and more
- **QR Scanner** - Read QR codes from images via drag-drop, file picker, or paste
- **Export Options** - Download as PNG, JPG, or SVG in various sizes
- **Privacy First** - All processing happens in your browser. No data leaves your device.

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Usage

1. **Generate QR Codes**: Enter text or URL, adjust colors and error correction, download
2. **Generate Barcodes**: Select format, enter valid data, customize appearance, download
3. **Scan Codes**: Drop an image, paste from clipboard, or click to select a file

## Supported Barcode Formats

| Format | Example Input |
|--------|---------------|
| CODE128 | `ABC-123` |
| CODE39 | `ABC123` |
| EAN-13 | `5901234123457` |
| EAN-8 | `96385074` |
| UPC-A | `012345678905` |
| ITF-14 | `10012345678902` |
| Codabar | `A12345B` |

## Tech Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS 4

## Development

See [ARCHITECTURE.md](./ARCHITECTURE.md) for technical documentation.

## License

MIT
