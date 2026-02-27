/**
 * Clipboard processing utilities
 */

import type { ScanResult, FoundItem } from '../types';

/** URL pattern for extracting links from text */
const URL_PATTERN = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

/** Trailing punctuation to strip from URLs */
const TRAILING_PUNCTUATION = /[.,;:!?)]+$/;

/** Max length for single-item toast message */
const MAX_MESSAGE_LENGTH = 50;

/** Extract URLs from text */
export function extractLinks(text: string): string[] {
  const matches = text.match(URL_PATTERN) || [];
  return [...new Set(matches.map(url => url.replace(TRAILING_PUNCTUATION, '')))];
}

/** Convert scan results to FoundItems */
export function toFoundItems(results: ScanResult[]): FoundItem[] {
  return results.map(r => ({
    data: r.data,
    type: r.type,
    label: r.type === 'qr' ? 'QR Code' : 'Barcode',
  }));
}

/** Convert links to FoundItems */
export function linksToItems(links: string[]): FoundItem[] {
  return links.map(link => ({ data: link, type: 'link' as const, label: 'Link' }));
}

/** Truncate text with ellipsis */
function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
}

/** Toast state for App component */
export interface ToastState {
  message: string;
  type: 'success' | 'error' | 'info';
  copyData?: string;
  items?: FoundItem[];
}

/** Build toast state from found items */
export function buildToast(items: FoundItem[]): ToastState | null {
  if (items.length === 0) return null;

  if (items.length === 1) {
    const item = items[0];
    return {
      message: truncate(item.data, MAX_MESSAGE_LENGTH),
      type: 'success',
      copyData: item.data,
    };
  }

  // Count items by type
  const counts = items.reduce(
    (acc, item) => {
      acc[item.type]++;
      return acc;
    },
    { qr: 0, barcode: 0, link: 0 }
  );

  const parts: string[] = [];
  if (counts.qr > 0) parts.push(`${counts.qr} QR`);
  if (counts.barcode > 0) parts.push(`${counts.barcode} barcode${counts.barcode > 1 ? 's' : ''}`);
  if (counts.link > 0) parts.push(`${counts.link} link${counts.link > 1 ? 's' : ''}`);

  return { message: `Found: ${parts.join(', ')}`, type: 'success', items };
}

/** Get image file from clipboard data (synchronous - must be called in event handler) */
export function getImageFromClipboardData(clipboardData: DataTransfer): File | null {
  for (let i = 0; i < clipboardData.items.length; i++) {
    const item = clipboardData.items[i];
    if (item.type.startsWith('image/')) {
      return item.getAsFile();
    }
  }
  return null;
}

/** Truncate filename for display */
export function truncateFilename(name: string, maxLength = 30): string {
  return truncate(name, maxLength);
}
