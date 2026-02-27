/**
 * Scanner utilities for reading QR codes and barcodes from images
 * Prioritizes QR scanning (smaller library, more common use case)
 */

import jsQR from 'jsqr';
import Quagga from '@ericblade/quagga2';
import type { ScanResult } from '../types';

/** Common barcode readers for Quagga */
const BARCODE_READERS = [
  'code_128_reader',
  'ean_reader',
  'ean_8_reader',
  'code_39_reader',
  'code_93_reader',
  'upc_reader',
  'upc_e_reader',
  'codabar_reader',
  'i2of5_reader',
] as const;

/** Error threshold for barcode validation */
const ERROR_THRESHOLD = 0.25;

/**
 * Processes a Quagga result and returns the barcode if valid
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processQuaggaResult(result: any): string | null {
  const code = result?.codeResult?.code;
  if (!code) return null;

  const errors = result.codeResult.decodedCodes
    ?.filter((c: { error?: number }) => c.error !== undefined)
    .map((c: { error?: number }) => c.error || 0) || [];

  if (errors.length > 0) {
    const avgError = errors.reduce((a: number, b: number) => a + b, 0) / errors.length;
    if (avgError > ERROR_THRESHOLD) return null;
  }

  return code;
}

/**
 * Scans an image file for ALL QR codes and barcodes
 * Returns an array of all found codes, deduplicated
 */
export async function scanImageFileMultiple(file: File): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  const seenData = new Set<string>();

  try {
    const imageData = await fileToImageData(file);

    // Scan for QR codes first (smaller library, more common)
    for (const qr of scanMultipleQRCodes(imageData)) {
      if (!seenData.has(qr.data)) {
        seenData.add(qr.data);
        results.push(qr);
      }
    }

    // Scan barcodes
    for (const barcode of await scanMultipleBarcodes(file)) {
      if (!seenData.has(barcode.data)) {
        seenData.add(barcode.data);
        results.push(barcode);
      }
    }
  } catch (error) {
    console.error('Error scanning image:', error);
  }

  return results;
}

/**
 * Scans for multiple QR codes by analyzing the full image and grid sections
 */
function scanMultipleQRCodes(imageData: ImageData): ScanResult[] {
  const results: ScanResult[] = [];
  const seenData = new Set<string>();
  const timestamp = Date.now();

  const addResult = (data: string) => {
    if (!seenData.has(data)) {
      seenData.add(data);
      results.push({ data, type: 'qr', timestamp });
    }
  };

  // First try the full image
  const fullResult = jsQR(imageData.data, imageData.width, imageData.height);
  if (fullResult) addResult(fullResult.data);

  // Then try grid sections for multiple QR codes
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return results;

  // Create source canvas once
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = imageData.width;
  srcCanvas.height = imageData.height;
  const srcCtx = srcCanvas.getContext('2d');
  if (!srcCtx) return results;
  srcCtx.putImageData(imageData, 0, 0);

  // Try 2x2 and 3x3 grids with 50% overlap
  for (const gridSize of [2, 3]) {
    const sectionW = Math.floor(imageData.width / gridSize);
    const sectionH = Math.floor(imageData.height / gridSize);
    const stepX = sectionW >> 1;
    const stepY = sectionH >> 1;

    for (let y = 0; y <= imageData.height - sectionH; y += stepY) {
      for (let x = 0; x <= imageData.width - sectionW; x += stepX) {
        canvas.width = sectionW;
        canvas.height = sectionH;
        ctx.drawImage(srcCanvas, x, y, sectionW, sectionH, 0, 0, sectionW, sectionH);
        const sectionData = ctx.getImageData(0, 0, sectionW, sectionH);
        const result = jsQR(sectionData.data, sectionData.width, sectionData.height);
        if (result) addResult(result.data);
      }
    }
  }

  return results;
}

/**
 * Scans for barcodes using Quagga with multiple strategies
 */
async function scanMultipleBarcodes(file: File): Promise<ScanResult[]> {
  const dataUrl = await fileToDataUrl(file);
  if (!dataUrl) return [];

  const results: ScanResult[] = [];
  const seenData = new Set<string>();
  const timestamp = Date.now();

  const addResult = (code: string) => {
    if (!seenData.has(code)) {
      seenData.add(code);
      results.push({ data: code, type: 'barcode', timestamp });
    }
  };

  // Try multiple mode first
  const multiResults = await quaggaDecode(dataUrl, { multiple: true, patchSize: 'large', halfSample: false });
  multiResults.forEach(addResult);

  // Try different configs if no results
  if (results.length === 0) {
    const configs = [
      { patchSize: 'x-large', halfSample: false },
      { patchSize: 'large', halfSample: false },
      { patchSize: 'medium', halfSample: true },
    ] as const;

    for (const config of configs) {
      const singleResults = await quaggaDecode(dataUrl, { ...config, multiple: false });
      if (singleResults.length > 0) {
        singleResults.forEach(addResult);
        break;
      }
    }
  }

  return results;
}

/**
 * Unified Quagga decode function
 */
function quaggaDecode(
  dataUrl: string,
  config: { patchSize: string; halfSample: boolean; multiple: boolean }
): Promise<string[]> {
  return new Promise((resolve) => {
    Quagga.decodeSingle(
      {
        src: dataUrl,
        numOfWorkers: 0,
        locate: true,
        locator: { halfSample: config.halfSample, patchSize: config.patchSize },
        decoder: {
          readers: BARCODE_READERS as unknown as import('@ericblade/quagga2').QuaggaJSCodeReader[],
          multiple: config.multiple,
        },
      },
      (result) => {
        const codes: string[] = [];

        if (Array.isArray(result)) {
          for (const r of result) {
            const code = processQuaggaResult(r);
            if (code) codes.push(code);
          }
        } else if (result) {
          const code = processQuaggaResult(result);
          if (code) codes.push(code);
        }

        resolve(codes);
      }
    );
  });
}

/**
 * Converts a File to ImageData
 */
async function fileToImageData(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Failed to get canvas context'));
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Converts a File to data URL
 */
function fileToDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/**
 * Checks if a file is a supported image type
 */
export function isImageFile(file: File): boolean {
  return ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'].includes(file.type);
}
