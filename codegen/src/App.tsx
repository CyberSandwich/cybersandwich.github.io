/**
 * CodeGen - QR Code & Barcode Generator
 */

import { useState, useEffect, useCallback } from 'react';
import { QRGenerator } from './components/QRGenerator';
import { BarcodeGenerator } from './components/BarcodeGenerator';
import { Toast, Icon } from './components';
import { ICON_CLIPBOARD } from './constants/ui-icons';
import type { FoundItem } from './types';
import {
  extractLinks,
  toFoundItems,
  linksToItems,
  buildToast,
  getImageFromClipboardData,
  truncateFilename,
  type ToastState,
} from './utils/clipboard';

type Mode = 'qr' | 'barcode';

/** Lazy-loaded scanner module */
let scannerModule: typeof import('./utils/scanner') | null = null;
async function getScanner() {
  if (!scannerModule) {
    scannerModule = await import('./utils/scanner');
  }
  return scannerModule;
}

function App() {
  const [mode, setMode] = useState<Mode>('qr');
  const [sharedData, setSharedData] = useState('');
  const [toast, setToast] = useState<ToastState | null>(null);

  const clearToast = useCallback(() => setToast(null), []);

  /** Scan image file using lazy-loaded scanner */
  const scanImage = useCallback(async (file: File): Promise<FoundItem[]> => {
    const scanner = await getScanner();
    const results = await scanner.scanImageFileMultiple(file);
    return toFoundItems(results);
  }, []);

  /** Process clipboard content (image or text with links) */
  const processClipboardContent = useCallback(async () => {
    try {
      const clipboardItems = await navigator.clipboard.read();
      const items: FoundItem[] = [];

      for (const item of clipboardItems) {
        if (item.types.includes('image/png') || item.types.includes('image/jpeg')) {
          const blob = await item.getType(item.types.find(t => t.startsWith('image/')) || 'image/png');
          const file = new File([blob], 'clipboard.png', { type: blob.type });
          try {
            items.push(...await scanImage(file));
          } catch (err) {
            console.error('Scan error:', err);
          }
        }

        if (item.types.includes('text/plain')) {
          const blob = await item.getType('text/plain');
          const text = await blob.text();
          const links = extractLinks(text);
          if (links.length > 0) {
            items.push(...linksToItems(links));
          } else if (text.trim() && items.length === 0) {
            setSharedData(text.trim());
            setToast({ message: 'Text pasted', type: 'success' });
            return;
          }
        }
      }

      setToast(buildToast(items) ?? { message: 'Nothing found', type: 'info' });
    } catch {
      // Fallback for browsers without clipboard.read()
      try {
        const text = await navigator.clipboard.readText();
        if (!text) {
          setToast({ message: 'Clipboard empty', type: 'info' });
          return;
        }
        const links = extractLinks(text);
        if (links.length > 0) {
          setToast(buildToast(linksToItems(links))!);
        } else {
          setSharedData(text.trim());
          setToast({ message: 'Text pasted', type: 'success' });
        }
      } catch {
        setToast({ message: 'Clipboard access denied', type: 'error' });
      }
    }
  }, [scanImage]);

  /** Global paste handler */
  const handleGlobalPaste = useCallback(async (e: ClipboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    // IMPORTANT: Extract all data synchronously before any async calls
    // ClipboardData becomes invalid after the event handler yields
    const text = clipboardData.getData('text/plain');
    const imageFile = getImageFromClipboardData(clipboardData);

    const items: FoundItem[] = [];
    let hasImage = false;

    // Now process asynchronously with extracted data
    if (imageFile) {
      hasImage = true;
      e.preventDefault();
      try {
        items.push(...await scanImage(imageFile));
      } catch (err) {
        console.error('Scan failed:', err);
      }
    }

    // Handle text - either as links or plain text
    if (text) {
      const links = extractLinks(text);
      if (links.length > 0) {
        e.preventDefault();
        items.push(...linksToItems(links));
      } else if (text.trim() && items.length === 0) {
        e.preventDefault();
        setSharedData(text.trim());
        setToast({ message: 'Text pasted', type: 'success' });
        return;
      }
    }

    const result = buildToast(items);
    if (result) {
      setToast(result);
    } else if (hasImage) {
      setToast({ message: 'No code found in image', type: 'error' });
    }
  }, [scanImage]);

  /** Global drag handler */
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  /** Global drop handler */
  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const dataTransfer = e.dataTransfer;
    if (!dataTransfer) return;

    // Check for dropped files
    if (dataTransfer.files?.length > 0) {
      const scanner = await getScanner();
      const imageFiles = Array.from(dataTransfer.files).filter(f => scanner.isImageFile(f));

      if (imageFiles.length > 0) {
        const items: FoundItem[] = [];
        for (const file of imageFiles) {
          try {
            items.push(...await scanImage(file));
          } catch (err) {
            console.error('Failed to scan:', err);
          }
        }
        setToast(buildToast(items) ?? { message: 'No code found in image(s)', type: 'error' });
        return;
      }

      const file = dataTransfer.files[0];
      setToast({ message: `${truncateFilename(file.name)} is not a valid image`, type: 'error' });
      return;
    }

    // Check for dropped text
    const text = dataTransfer.getData('text/plain');
    if (text) {
      const links = extractLinks(text);
      if (links.length > 0) {
        setToast(buildToast(linksToItems(links))!);
      } else {
        setSharedData(text);
        setToast({ message: 'Text added', type: 'success' });
      }
    }
  }, [scanImage]);

  useEffect(() => {
    document.addEventListener('paste', handleGlobalPaste);
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);
    return () => {
      document.removeEventListener('paste', handleGlobalPaste);
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('drop', handleDrop);
    };
  }, [handleGlobalPaste, handleDragOver, handleDrop]);

  return (
    <div className="min-h-[100dvh] flex flex-col">
      {/* Paste Button - Top Right for touchscreens */}
      <button
        onClick={processClipboardContent}
        className="fixed top-4 right-4 z-40 p-3 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-accent)] transition-all shadow-lg"
        title="Paste image or text"
      >
        <Icon path={ICON_CLIPBOARD} />
      </button>

      <main className="flex-1 flex flex-col p-4 sm:p-6 lg:p-8">
        {/* Mode Toggle */}
        <div className="flex justify-center pb-4 sm:pb-6">
          <div className="inline-flex p-1 rounded-full bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
            <button
              onClick={() => setMode('qr')}
              className={`px-5 py-2 text-sm font-medium rounded-full transition-all ${
                mode === 'qr'
                  ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-primary)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              QR
            </button>
            <button
              onClick={() => setMode('barcode')}
              className={`px-5 py-2 text-sm font-medium rounded-full transition-all ${
                mode === 'barcode'
                  ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-primary)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              Barcode
            </button>
          </div>
        </div>

        {/* Generator */}
        <div className="flex-1 flex flex-col">
          {mode === 'qr' ? (
            <QRGenerator data={sharedData} onDataChange={setSharedData} />
          ) : (
            <BarcodeGenerator data={sharedData} onDataChange={setSharedData} />
          )}
        </div>
      </main>

      {/* Toast */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          copyData={toast.copyData}
          items={toast.items}
          onClose={clearToast}
        />
      )}
    </div>
  );
}

export default App;
