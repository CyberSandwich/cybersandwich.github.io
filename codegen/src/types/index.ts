/**
 * Core type definitions for CodeGen application
 */

/** QR Code error correction levels - higher = more redundancy */
export type QRErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

/** Supported barcode formats */
export type BarcodeFormat =
  | 'CODE128'
  | 'CODE39'
  | 'CODE93'
  | 'EAN13'
  | 'EAN8'
  | 'UPC'
  | 'UPCE'
  | 'ITF'
  | 'MSI'
  | 'pharmacode'
  | 'codabar';

/** Export format options */
export type ExportFormat = 'png' | 'jpg' | 'webp' | 'svg';

/** Size preset configuration */
export interface SizePreset {
  label: string;
  width: number;
  height: number;
}

/** QR Code styling options */
export interface QRStyleOptions {
  fgColor: string;
  bgColor: string;
  cornerRadius: number;
  dotStyle: 'square' | 'rounded' | 'dots';
}

/** Barcode styling options */
export interface BarcodeStyleOptions {
  lineColor: string;
  bgColor: string;
  displayValue: boolean;
  font: string;
  fontSize: number;
  textAlign: 'left' | 'center' | 'right';
  textMargin: number;
}

/** QR Code generation configuration */
export interface QRConfig {
  data: string;
  errorCorrection: QRErrorCorrectionLevel;
  size: number;
  margin: number;
  style: QRStyleOptions;
}

/** Barcode generation configuration */
export interface BarcodeConfig {
  data: string;
  format: BarcodeFormat;
  width: number;
  height: number;
  margin: number;
  style: BarcodeStyleOptions;
}

/** Scan result from QR/barcode reader */
export interface ScanResult {
  data: string;
  type: 'qr' | 'barcode';
  timestamp: number;
}

/** Found item for toast display (scan results + extracted links) */
export interface FoundItem {
  data: string;
  type: 'qr' | 'barcode' | 'link';
  label: string;
}
