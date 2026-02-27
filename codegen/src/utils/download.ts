/**
 * Shared download utilities for canvas exports
 */

import type { ExportFormat } from '../types';

/** MIME types and quality settings for each format */
const FORMAT_CONFIG: Record<Exclude<ExportFormat, 'svg'>, { mime: string; quality?: number }> = {
  png: { mime: 'image/png' },
  webp: { mime: 'image/webp', quality: 0.92 },
  jpg: { mime: 'image/jpeg', quality: 0.92 },
};

/** Convert canvas to data URL with format handling */
function canvasToDataUrl(
  canvas: HTMLCanvasElement,
  format: ExportFormat
): { dataUrl: string; extension: string } {
  // SVG export falls back to PNG (canvas doesn't support SVG directly)
  const effectiveFormat = format === 'svg' ? 'png' : format;
  const config = FORMAT_CONFIG[effectiveFormat];

  return {
    dataUrl: canvas.toDataURL(config.mime, config.quality),
    extension: effectiveFormat,
  };
}

/** Trigger download of data URL as file */
function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  link.click();
}

/** Export canvas as downloadable file */
export function exportCanvas(
  canvas: HTMLCanvasElement,
  format: ExportFormat,
  basename: string
): void {
  const { dataUrl, extension } = canvasToDataUrl(canvas, format);
  downloadDataUrl(dataUrl, `${basename}.${extension}`);
}
