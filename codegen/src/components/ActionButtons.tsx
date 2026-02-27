/**
 * Shared action buttons for generators
 */

import { ICON_SETTINGS, ICON_SETTINGS_INNER, ICON_COPY, ICON_DOWNLOAD } from '../constants/ui-icons';
import { Icon } from './Icon';

interface ActionButtonsProps {
  showOptions: boolean;
  onToggleOptions: () => void;
  onCopy: () => void;
  onExport: () => void;
  copyDisabled?: boolean;
  exportDisabled?: boolean;
}

export function ActionButtons({
  showOptions,
  onToggleOptions,
  onCopy,
  onExport,
  copyDisabled = false,
  exportDisabled = false,
}: ActionButtonsProps) {
  return (
    <div className="flex gap-3 w-full max-w-[320px]">
      <button
        onClick={onToggleOptions}
        className={`px-4 py-3 rounded-2xl transition-all ${
          showOptions
            ? 'bg-[var(--color-accent)] text-white'
            : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
        }`}
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d={ICON_SETTINGS} />
          <path strokeLinecap="round" strokeLinejoin="round" d={ICON_SETTINGS_INNER} />
        </svg>
      </button>
      <button
        onClick={onCopy}
        disabled={copyDisabled}
        className="px-4 py-3 rounded-2xl bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <Icon path={ICON_COPY} />
      </button>
      <button
        onClick={onExport}
        disabled={exportDisabled}
        className="flex-1 py-3 rounded-2xl bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
      >
        <Icon path={ICON_DOWNLOAD} />
      </button>
    </div>
  );
}
