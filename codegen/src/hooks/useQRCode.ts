/**
 * QR Code generation hook with custom dot styles
 * Uses shared rendering from utils/qrRender.ts
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import QRCode from 'qrcode';
import type { QRConfig } from '../types';
import { DEFAULT_QR_SIZE, DEFAULT_MARGIN, DEFAULT_QR_STYLE } from '../constants';
import { drawQRModules, drawQRLogo } from '../utils/qrRender';

interface UseQRCodeOptions {
  data: string;
  size?: number;
  margin?: number;
  errorCorrection?: QRConfig['errorCorrection'];
  style?: Partial<QRConfig['style']>;
  logo?: string | null;
  transparentBg?: boolean;
}

interface UseQRCodeReturn {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  isValid: boolean;
  error: string | null;
  regenerate: () => void;
}

export function useQRCode(options: UseQRCodeOptions): UseQRCodeReturn {
  const {
    data,
    size = DEFAULT_QR_SIZE,
    margin = DEFAULT_MARGIN,
    errorCorrection = 'M',
    style = {},
    logo = null,
    transparentBg = false,
  } = options;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [renderKey, setRenderKey] = useState(0);

  const fgColor = style.fgColor ?? DEFAULT_QR_STYLE.fgColor;
  const bgColor = style.bgColor ?? DEFAULT_QR_STYLE.bgColor;
  const dotStyle = style.dotStyle ?? DEFAULT_QR_STYLE.dotStyle;

  const isValid = data.trim().length > 0;

  // Generate QR code when dependencies change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isValid) return;

    let cancelled = false;

    const generate = async () => {
      try {
        if (cancelled) return;

        const segments = QRCode.create(data, { errorCorrectionLevel: errorCorrection });
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get canvas context');

        // Set canvas size
        canvas.width = size;
        canvas.height = size;

        // Use shared rendering function (scaleMargin=false for preview)
        const layoutInfo = drawQRModules(ctx, segments.modules, {
          size,
          margin,
          fgColor,
          bgColor,
          dotStyle,
          transparentBg,
          logo,
          scaleMargin: false,
        });

        // Draw logo if provided
        if (logo) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            if (cancelled) return;
            drawQRLogo(ctx, img, {
              ...layoutInfo,
              bgColor,
              transparentBg,
              size,
              scaleMargin: false,
            });
          };
          img.src = logo;
        }

        if (!cancelled) {
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to generate QR code');
        }
      }
    };

    generate();

    return () => {
      cancelled = true;
    };
  }, [data, size, margin, errorCorrection, fgColor, bgColor, dotStyle, isValid, renderKey, logo, transparentBg]);

  const regenerate = useCallback(() => {
    setRenderKey((k) => k + 1);
  }, []);

  return {
    canvasRef,
    isValid,
    error,
    regenerate,
  };
}
