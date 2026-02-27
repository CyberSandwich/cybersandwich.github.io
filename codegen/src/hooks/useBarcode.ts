/**
 * Barcode generation hook
 *
 * Provides reactive barcode generation using JsBarcode library.
 * Supports multiple barcode formats with customizable styling.
 */

/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useRef, useCallback, useState } from 'react';
import JsBarcode from 'jsbarcode';
import type { BarcodeConfig, BarcodeFormat } from '../types';
import {
  DEFAULT_BARCODE_WIDTH,
  DEFAULT_BARCODE_HEIGHT,
  DEFAULT_MARGIN,
  DEFAULT_BARCODE_STYLE,
  BARCODE_FORMATS,
} from '../constants';
import { buildBarcodeOptions } from '../utils/barcodeRender';

interface UseBarcodeOptions {
  data: string;
  format?: BarcodeFormat;
  width?: number;
  height?: number;
  margin?: number;
  style?: Partial<BarcodeConfig['style']>;
}

interface UseBarcodeReturn {
  svgRef: React.RefObject<SVGSVGElement | null>;
  isValid: boolean;
  error: string | null;
  regenerate: () => void;
}

/**
 * Hook for generating barcodes on an SVG element
 *
 * @param options - Barcode configuration options
 * @returns SVG ref and generation status
 *
 * @example
 * const { svgRef, isValid } = useBarcode({
 *   data: '123456789012',
 *   format: 'EAN13',
 * });
 */
export function useBarcode(options: UseBarcodeOptions): UseBarcodeReturn {
  const {
    data,
    format = 'CODE128',
    width = DEFAULT_BARCODE_WIDTH,
    height = DEFAULT_BARCODE_HEIGHT,
    margin = DEFAULT_MARGIN,
    style = {},
  } = options;

  const svgRef = useRef<SVGSVGElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [renderKey, setRenderKey] = useState(0);

  // Extract style values with defaults
  const lineColor = style.lineColor ?? DEFAULT_BARCODE_STYLE.lineColor;
  const bgColor = style.bgColor ?? DEFAULT_BARCODE_STYLE.bgColor;
  const displayValue = style.displayValue ?? DEFAULT_BARCODE_STYLE.displayValue;
  const font = style.font ?? DEFAULT_BARCODE_STYLE.font;
  const fontSize = style.fontSize ?? DEFAULT_BARCODE_STYLE.fontSize;
  const textAlign = style.textAlign ?? DEFAULT_BARCODE_STYLE.textAlign;
  const textMargin = style.textMargin ?? DEFAULT_BARCODE_STYLE.textMargin;

  // Validate data against format pattern
  const isValid = validateBarcodeData(data, format);

  // Generate barcode when dependencies change
  useEffect(() => {
    const svg = svgRef.current;

    if (!svg || !data.trim()) {
      setError(null);
      return;
    }

    // Clear previous SVG content (safe - not user content)
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    try {
      JsBarcode(svg, data, {
        format,
        ...buildBarcodeOptions(style, width, height, margin, fontSize, textMargin),
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid barcode data for format');
    }
  }, [
    data,
    format,
    width,
    height,
    margin,
    lineColor,
    bgColor,
    displayValue,
    font,
    fontSize,
    textAlign,
    textMargin,
    style,
    renderKey,
  ]);

  const regenerate = useCallback(() => {
    setRenderKey((k) => k + 1);
  }, []);

  return {
    svgRef,
    isValid,
    error,
    regenerate,
  };
}

/**
 * Validates barcode data against format requirements
 * Uses patterns from BARCODE_FORMATS, with special handling for pharmacode
 */
function validateBarcodeData(
  data: string,
  format: BarcodeFormat
): boolean {
  if (!data.trim()) return false;

  // Special case: pharmacode has numeric range validation
  if (format === 'pharmacode') {
    const num = parseInt(data, 10);
    return !isNaN(num) && num >= 3 && num <= 131070;
  }

  // Use pattern from BARCODE_FORMATS if available
  const formatConfig = BARCODE_FORMATS.find(f => f.value === format);
  if (formatConfig?.pattern) {
    return formatConfig.pattern.test(data);
  }

  // CODE128 and others without patterns accept most characters
  return data.length > 0;
}
