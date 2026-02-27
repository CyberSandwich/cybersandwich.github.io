/**
 * Toast notification component with multi-item support
 */

import { useEffect, useState, useCallback } from 'react';
import type { FoundItem } from '../types';
import { ICON_CLOSE, ICON_INFO, ICON_SUCCESS_CIRCLE, ICON_ERROR_CIRCLE } from '../constants/ui-icons';
import { Icon } from './Icon';

/** Toast timing constants */
const COPY_FEEDBACK_DURATION = 1500;
const EXIT_ANIMATION_DURATION = 150;
const DEFAULT_DURATION = 6000;
const ITEMS_DURATION = 15000;

/** Toast style mappings by type */
const TOAST_STYLES = {
  success: {
    bg: 'bg-[var(--color-bg-secondary)] border border-[var(--color-success)]/30',
    icon: 'text-[var(--color-success)]',
  },
  error: {
    bg: 'bg-[var(--color-bg-secondary)] border border-[var(--color-error)]/30',
    icon: 'text-[var(--color-error)]',
  },
  info: {
    bg: 'bg-[var(--color-bg-secondary)] border border-[var(--color-border)]',
    icon: 'text-[var(--color-text-muted)]',
  },
} as const;

/** Badge style mappings by item type */
const BADGE_STYLES = {
  qr: 'bg-purple-500/20 text-purple-400',
  barcode: 'bg-blue-500/20 text-blue-400',
  link: 'bg-green-500/20 text-green-400',
} as const;

/** Toast icons by type - uses shared icon constants */
const TOAST_ICONS = {
  success: ICON_SUCCESS_CIRCLE,
  error: ICON_ERROR_CIRCLE,
  info: ICON_INFO,
} as const;

interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info';
  duration?: number;
  onClose: () => void;
  copyData?: string;
  items?: FoundItem[];
}

export function Toast({ message, type = 'info', duration = DEFAULT_DURATION, onClose, copyData, items }: ToastProps) {
  const [isExiting, setIsExiting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const hasItems = (items?.length ?? 0) > 0;
  const styles = TOAST_STYLES[type];

  // Auto-close timer
  useEffect(() => {
    const effectiveDuration = hasItems ? ITEMS_DURATION : duration;
    const timer = setTimeout(() => {
      setIsExiting(true);
      setTimeout(onClose, EXIT_ANIMATION_DURATION);
    }, effectiveDuration);

    return () => clearTimeout(timer);
  }, [duration, onClose, hasItems]);

  const handleClose = useCallback(() => {
    setIsExiting(true);
    setTimeout(onClose, EXIT_ANIMATION_DURATION);
  }, [onClose]);

  const handleCopy = useCallback(() => {
    if (copyData) {
      navigator.clipboard.writeText(copyData);
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION);
    }
  }, [copyData]);

  const handleCopyItem = useCallback((data: string, index: number) => {
    navigator.clipboard.writeText(data);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), COPY_FEEDBACK_DURATION);
  }, []);

  const handleCopyAll = useCallback(() => {
    if (items && items.length > 0) {
      navigator.clipboard.writeText(items.map(item => item.data).join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION);
    }
  }, [items]);

  return (
    <div
      className={`fixed bottom-4 right-4 left-4 sm:left-auto z-50 flex flex-col rounded-2xl ${styles.bg} shadow-xl backdrop-blur-lg ${
        isExiting ? 'toast-exit' : 'toast-enter'
      } ${hasItems ? 'sm:w-[400px]' : ''}`}
    >
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Icon */}
        <div className={styles.icon}>
          <Icon path={TOAST_ICONS[type]} />
        </div>

        {/* Message */}
        <span className="flex-1 text-sm text-[var(--color-text-primary)] font-mono truncate">
          {message}
        </span>

        {/* Single copy button */}
        {copyData && !hasItems && (
          <button
            onClick={handleCopy}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              copied
                ? 'bg-[var(--color-success)] text-white'
                : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        )}

        {/* Copy All button (with items) */}
        {hasItems && (
          <button
            onClick={handleCopyAll}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              copied
                ? 'bg-[var(--color-success)] text-white'
                : 'bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]'
            }`}
          >
            {copied ? 'Copied!' : 'Copy All'}
          </button>
        )}

        {/* Close */}
        <button
          onClick={handleClose}
          className="p-1 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          <Icon path={ICON_CLOSE} className="w-4 h-4" />
        </button>
      </div>

      {/* Items list (QR codes, barcodes, links) */}
      {hasItems && items && (
        <div className="px-4 pb-3 max-h-48 overflow-y-auto">
          <div className="space-y-2">
            {items.map((item, index) => (
              <div key={index} className="flex items-center gap-2 p-2 rounded-xl bg-[var(--color-bg-tertiary)]">
                <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded shrink-0 ${BADGE_STYLES[item.type]}`}>
                  {item.label}
                </span>
                <span className="flex-1 text-xs font-mono text-[var(--color-text-secondary)] truncate">
                  {item.data}
                </span>
                <button
                  onClick={() => handleCopyItem(item.data, index)}
                  className={`px-2 py-1 rounded-lg text-xs transition-all shrink-0 ${
                    copiedIndex === index
                      ? 'bg-[var(--color-success)] text-white'
                      : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  {copiedIndex === index ? 'Copied!' : 'Copy'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
