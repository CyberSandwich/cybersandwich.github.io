/**
 * Application constants
 */

import type {
  QRErrorCorrectionLevel,
  BarcodeFormat,
  SizePreset,
  QRStyleOptions,
  BarcodeStyleOptions,
} from '../types';

/** QR Code error correction levels */
export const ERROR_CORRECTION_LEVELS: {
  value: QRErrorCorrectionLevel;
  label: string;
  recovery: string;
}[] = [
  { value: 'L', label: 'L', recovery: '7%' },
  { value: 'M', label: 'M', recovery: '15%' },
  { value: 'Q', label: 'Q', recovery: '25%' },
  { value: 'H', label: 'H', recovery: '30%' },
];

/** Pre-computed error correction options for ButtonGroup */
export const ERROR_CORRECTION_OPTIONS = ERROR_CORRECTION_LEVELS.map(l => ({ value: l.value, label: l.value }));

/** Supported barcode formats */
export const BARCODE_FORMATS: {
  value: BarcodeFormat;
  label: string;
  placeholder: string;
  pattern?: RegExp;
  description: string;
}[] = [
  { value: 'CODE128', label: 'Code 128', placeholder: '1234', description: 'Any ASCII characters' },
  { value: 'CODE39', label: 'Code 39', placeholder: '1234', pattern: /^[A-Z0-9\-. $/+%]*$/, description: 'A-Z, 0-9, - . $ / + % space' },
  { value: 'CODE93', label: 'Code 93', placeholder: '1234', pattern: /^[A-Z0-9\-. $/+%]*$/, description: 'A-Z, 0-9, - . $ / + % space' },
  { value: 'EAN13', label: 'EAN-13', placeholder: '123456789012', pattern: /^\d{12,13}$/, description: '12-13 digits' },
  { value: 'EAN8', label: 'EAN-8', placeholder: '1234567', pattern: /^\d{7,8}$/, description: '7-8 digits' },
  { value: 'UPC', label: 'UPC-A', placeholder: '12345678901', pattern: /^\d{11,12}$/, description: '11-12 digits' },
  { value: 'UPCE', label: 'UPC-E', placeholder: '123456', pattern: /^\d{6,8}$/, description: '6-8 digits' },
  { value: 'ITF', label: 'ITF-14', placeholder: '12345678901234', pattern: /^\d{14}$/, description: '14 digits (any numbers)' },
  { value: 'MSI', label: 'MSI', placeholder: '1234', pattern: /^\d+$/, description: 'Digits only' },
  { value: 'pharmacode', label: 'Pharmacode', placeholder: '123', pattern: /^\d+$/, description: 'Number 3-131070' },
  { value: 'codabar', label: 'Codabar', placeholder: 'A1234B', pattern: /^[A-D][0-9\-$:/.+]+[A-D]$/i, description: 'Start/end A-D, digits and - $ : / . +' },
];

/** Barcode size presets */
export const BARCODE_SIZE_PRESETS: SizePreset[] = [
  { label: 'S', width: 200, height: 80 },
  { label: 'M', width: 300, height: 100 },
  { label: 'L', width: 400, height: 150 },
  { label: 'XL', width: 600, height: 200 },
];

/** Default QR code styling - black on white */
export const DEFAULT_QR_STYLE: QRStyleOptions = {
  fgColor: '#000000',
  bgColor: '#ffffff',
  cornerRadius: 0,
  dotStyle: 'square',
};

/** Default barcode styling - black on white */
export const DEFAULT_BARCODE_STYLE: BarcodeStyleOptions = {
  lineColor: '#000000',
  bgColor: '#ffffff',
  displayValue: true,
  font: 'monospace',
  fontSize: 14,
  textAlign: 'center',
  textMargin: 4,
};

/** Default QR code size */
export const DEFAULT_QR_SIZE = 280;

/** Default barcode dimensions */
export const DEFAULT_BARCODE_WIDTH = 2;
export const DEFAULT_BARCODE_HEIGHT = 100;

/** Default margin */
export const DEFAULT_MARGIN = 16;

/** Export format options */
export const EXPORT_FORMATS: ('png' | 'webp' | 'jpg' | 'svg')[] = ['png', 'webp', 'jpg', 'svg'];

/** Pre-computed format options for ButtonGroup */
export const FORMAT_OPTIONS = EXPORT_FORMATS.map(f => ({ value: f, label: f }));

/** QR size presets */
export const QR_SIZE_PRESETS = [
  { label: 'S', value: 128 },
  { label: 'M', value: 256 },
  { label: 'L', value: 512 },
  { label: 'XL', value: 1024 },
];

/** Font options for barcode text */
export const TEXT_FONTS = [
  { value: 'monospace', label: 'Mono' },
  { value: 'sans-serif', label: 'Sans' },
  { value: 'serif', label: 'Serif' },
] as const;

/** Pre-computed font options for ButtonGroup */
export const FONT_OPTIONS = TEXT_FONTS.map(f => ({ value: f.value, label: f.label }));

/** Default QR code data */
export const DEFAULT_QR_DATA = 'https://saputra.co.uk';

/** Default barcode data (matches CODE128 placeholder) */
export const DEFAULT_BARCODE_DATA = '1234';
