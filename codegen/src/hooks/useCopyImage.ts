/**
 * Hook for copying canvas images to clipboard with Safari support
 */

import { useState, useCallback } from 'react';

interface UseCopyImageReturn {
  copySuccess: boolean;
  copyError: boolean;
  copyToClipboard: (getCanvas: () => Promise<HTMLCanvasElement>) => Promise<void>;
}

/** Timeout duration for feedback states */
const FEEDBACK_DURATION = 4000;

/**
 * Hook that handles copying canvas images to clipboard
 * Uses Promise-based ClipboardItem for Safari compatibility
 */
export function useCopyImage(): UseCopyImageReturn {
  const [copySuccess, setCopySuccess] = useState(false);
  const [copyError, setCopyError] = useState(false);

  const copyToClipboard = useCallback(async (getCanvas: () => Promise<HTMLCanvasElement>) => {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      setCopyError(true);
      setTimeout(() => setCopyError(false), FEEDBACK_DURATION);
      return;
    }

    try {
      // Safari requires Promise passed directly to ClipboardItem (not awaited blob)
      // This preserves the user gesture context
      const blobPromise = getCanvas().then(
        (canvas) =>
          new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
              (blob) => (blob ? resolve(blob) : reject(new Error('Failed to create blob'))),
              'image/png',
              1.0
            );
          })
      );

      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), FEEDBACK_DURATION);
    } catch (err) {
      console.error('Failed to copy:', err);
      setCopyError(true);
      setTimeout(() => setCopyError(false), FEEDBACK_DURATION);
    }
  }, []);

  return { copySuccess, copyError, copyToClipboard };
}
