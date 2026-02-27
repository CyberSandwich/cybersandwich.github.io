/**
 * Barcode rendering utility for generating barcodes at any resolution
 */

import JsBarcode from 'jsbarcode';
import type { BarcodeFormat, BarcodeStyleOptions } from '../types';
import { DEFAULT_BARCODE_STYLE, DEFAULT_BARCODE_WIDTH, DEFAULT_BARCODE_HEIGHT, DEFAULT_MARGIN } from '../constants';

interface RenderBarcodeOptions {
  data: string;
  format: BarcodeFormat;
  targetWidth: number;
  previewBarWidth?: number;
  previewBarHeight?: number;
  margin?: number;
  style?: Partial<BarcodeStyleOptions>;
}

/** Shared JsBarcode options builder - exported for use by useBarcode hook */
export function buildBarcodeOptions(
  style: Partial<BarcodeStyleOptions>,
  barWidth: number,
  barHeight: number,
  margin: number,
  fontSize: number,
  textMargin: number
) {
  return {
    width: barWidth,
    height: barHeight,
    margin,
    displayValue: style.displayValue ?? DEFAULT_BARCODE_STYLE.displayValue,
    font: style.font ?? DEFAULT_BARCODE_STYLE.font,
    fontSize,
    textAlign: style.textAlign ?? DEFAULT_BARCODE_STYLE.textAlign,
    textMargin,
    lineColor: style.lineColor ?? DEFAULT_BARCODE_STYLE.lineColor,
    background: style.bgColor ?? DEFAULT_BARCODE_STYLE.bgColor,
  };
}

/**
 * Renders a barcode to a canvas at specified target width
 * Scales all dimensions proportionally from preview settings
 */
export async function renderBarcodeToCanvas(options: RenderBarcodeOptions): Promise<HTMLCanvasElement> {
  const {
    data,
    format,
    targetWidth,
    previewBarWidth = DEFAULT_BARCODE_WIDTH,
    previewBarHeight = DEFAULT_BARCODE_HEIGHT,
    margin = DEFAULT_MARGIN,
    style = {},
  } = options;

  const previewFontSize = style.fontSize ?? DEFAULT_BARCODE_STYLE.fontSize;
  const previewTextMargin = style.textMargin ?? DEFAULT_BARCODE_STYLE.textMargin;

  // Create temporary SVGs for measurement and export
  const measureSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const exportSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

  // Use a hidden container to avoid DOM reflow issues
  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;left:-9999px;visibility:hidden';
  container.appendChild(measureSvg);
  container.appendChild(exportSvg);
  document.body.appendChild(container);

  try {
    // Render at preview size to measure natural dimensions
    JsBarcode(measureSvg, data, {
      format,
      ...buildBarcodeOptions(style, previewBarWidth, previewBarHeight, margin, previewFontSize, previewTextMargin),
    });

    // Get natural dimensions
    const previewWidth = measureSvg.getBoundingClientRect().width || measureSvg.width.baseVal.value;
    const previewHeight = measureSvg.getBoundingClientRect().height || measureSvg.height.baseVal.value;

    // Calculate scale ratio and render at target size
    const scale = targetWidth / previewWidth;
    const targetHeight = Math.round(previewHeight * scale);

    JsBarcode(exportSvg, data, {
      format,
      ...buildBarcodeOptions(
        style,
        previewBarWidth * scale,
        previewBarHeight * scale,
        margin * scale,
        Math.round(previewFontSize * scale),
        Math.round(previewTextMargin * scale)
      ),
    });

    return await svgToCanvas(exportSvg, targetWidth, targetHeight);
  } finally {
    document.body.removeChild(container);
  }
}

/**
 * Converts SVG element to canvas at exact dimensions
 */
function svgToCanvas(
  svg: SVGSVGElement,
  targetWidth: number,
  targetHeight: number
): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svg);
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to get canvas context'));
        return;
      }

      // Enable smoothing for crisp text rendering
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load SVG'));
    };
    img.src = url;
  });
}
