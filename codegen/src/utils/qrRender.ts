/**
 * QR Code rendering utility - single source of truth for all QR rendering
 */

import QRCode from 'qrcode';
import type { QRConfig } from '../types';
import { DEFAULT_QR_STYLE, DEFAULT_MARGIN } from '../constants';
import { roundRect } from './canvas';

interface RenderQROptions {
  data: string;
  size: number;
  margin?: number;
  errorCorrection?: QRConfig['errorCorrection'];
  style?: Partial<QRConfig['style']>;
  logo?: string | null;
  transparentBg?: boolean;
  /** For preview rendering - uses fixed margin; for export - scales margin */
  scaleMargin?: boolean;
}

interface QRModuleData {
  modules: { get(row: number, col: number): number; size: number };
}

/**
 * Core QR rendering function - draws QR modules to a canvas context
 * Used by both preview (useQRCode) and export (renderQRToCanvas)
 */
export function drawQRModules(
  ctx: CanvasRenderingContext2D,
  modules: QRModuleData['modules'],
  options: {
    size: number;
    margin: number;
    fgColor: string;
    bgColor: string;
    dotStyle: 'square' | 'rounded' | 'dots';
    transparentBg: boolean;
    logo: string | null;
    scaleMargin?: boolean;
  }
): { moduleSize: number; offset: number; logoZoneStart: number; logoZoneEnd: number; logoZoneModules: number } {
  const { size, margin, fgColor, bgColor, dotStyle, transparentBg, logo, scaleMargin } = options;
  const moduleCount = modules.size;

  // Calculate margin - for export we scale proportionally, for preview we use fixed
  const effectiveMargin = scaleMargin ? Math.round((margin / 320) * size) : margin;
  const availableSize = size - effectiveMargin * 2;
  // Use integer module size to avoid sub-pixel gaps
  const moduleSize = Math.floor(availableSize / moduleCount);
  // Center the QR within available space after rounding
  const actualQRSize = moduleSize * moduleCount;
  const offset = Math.floor((size - actualQRSize) / 2);

  // Disable smoothing for crisp, sharp pixels
  ctx.imageSmoothingEnabled = false;

  // Fill background (or clear for transparent)
  if (transparentBg) {
    ctx.clearRect(0, 0, size, size);
  } else {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, size, size);
  }

  // Calculate logo zone (center ~25% of modules, snapped to module boundaries)
  const logoZoneModules = logo ? Math.floor(moduleCount * 0.25) : 0;
  const logoZoneStart = Math.floor((moduleCount - logoZoneModules) / 2);
  const logoZoneEnd = logoZoneStart + logoZoneModules;

  // Draw modules
  ctx.fillStyle = fgColor;

  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      // Skip modules in logo zone
      if (logo && row >= logoZoneStart && row < logoZoneEnd && col >= logoZoneStart && col < logoZoneEnd) {
        continue;
      }

      if (modules.get(row, col)) {
        const x = offset + col * moduleSize;
        const y = offset + row * moduleSize;

        if (dotStyle === 'dots') {
          const centerX = x + moduleSize / 2;
          const centerY = y + moduleSize / 2;
          const radius = moduleSize * 0.4;
          ctx.beginPath();
          ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
          ctx.fill();
        } else if (dotStyle === 'rounded') {
          const cornerRadius = moduleSize * 0.3;
          roundRect(ctx, x + moduleSize * 0.05, y + moduleSize * 0.05, moduleSize * 0.9, moduleSize * 0.9, cornerRadius);
        } else {
          // Square (default) - integer coords prevent sub-pixel gaps
          ctx.fillRect(x, y, moduleSize, moduleSize);
        }
      }
    }
  }

  return { moduleSize, offset, logoZoneStart, logoZoneEnd, logoZoneModules };
}

/**
 * Draws a logo on the QR code canvas
 */
export function drawQRLogo(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  options: {
    offset: number;
    logoZoneStart: number;
    logoZoneModules: number;
    moduleSize: number;
    bgColor: string;
    transparentBg: boolean;
    size: number;
    scaleMargin?: boolean;
  }
): void {
  const { offset, logoZoneStart, logoZoneModules, moduleSize, bgColor, transparentBg, size, scaleMargin } = options;

  // Calculate logo position to match the skipped module zone exactly
  const logoPixelSize = logoZoneModules * moduleSize;
  const logoX = offset + logoZoneStart * moduleSize;
  const logoY = offset + logoZoneStart * moduleSize;

  // Draw rounded background for logo (for better visibility)
  if (!transparentBg) {
    ctx.fillStyle = bgColor;
    const padding = scaleMargin ? (2 / 320) * size : 2;
    const bgSize = logoPixelSize + padding * 2;
    const cornerRadius = bgSize * 0.1;
    roundRect(ctx, logoX - padding, logoY - padding, bgSize, bgSize, cornerRadius);
  }

  // Draw logo centered within the zone with small padding
  const logoPadding = logoPixelSize * 0.08;
  ctx.drawImage(img, logoX + logoPadding, logoY + logoPadding, logoPixelSize - logoPadding * 2, logoPixelSize - logoPadding * 2);
}

/**
 * Renders a QR code to a canvas at native resolution
 * Returns a Promise that resolves to the canvas element
 */
export async function renderQRToCanvas(options: RenderQROptions): Promise<HTMLCanvasElement> {
  const {
    data,
    size,
    margin = DEFAULT_MARGIN,
    errorCorrection = 'M',
    style = {},
    logo = null,
    transparentBg = false,
    scaleMargin = true,
  } = options;

  const fgColor = style.fgColor ?? DEFAULT_QR_STYLE.fgColor;
  const bgColor = style.bgColor ?? DEFAULT_QR_STYLE.bgColor;
  const dotStyle = style.dotStyle ?? DEFAULT_QR_STYLE.dotStyle;

  // Create QR code data
  const segments = QRCode.create(data, { errorCorrectionLevel: errorCorrection });

  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Could not get canvas context');
  }

  // Draw QR modules
  const layoutInfo = drawQRModules(ctx, segments.modules, {
    size,
    margin,
    fgColor,
    bgColor,
    dotStyle,
    transparentBg,
    logo,
    scaleMargin,
  });

  // Draw logo if provided
  if (logo) {
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        drawQRLogo(ctx, img, {
          ...layoutInfo,
          bgColor,
          transparentBg,
          size,
          scaleMargin,
        });
        resolve();
      };
      img.onerror = () => resolve(); // Continue without logo on error
      img.src = logo;
    });
  }

  return canvas;
}
