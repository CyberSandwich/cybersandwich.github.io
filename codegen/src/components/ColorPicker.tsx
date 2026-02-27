/**
 * Color Picker Component - Compact visual color selector
 */

import { useState, useRef, useEffect, useCallback } from 'react';

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

// Compact color palette - most useful colors
const COLOR_PALETTE = [
  // Row 1: Grayscale
  ['#ffffff', '#f5f5f5', '#d4d4d4', '#a3a3a3', '#525252', '#262626', '#000000'],
  // Row 2: Colors
  ['#ef4444', '#f97316', '#eab308', '#22c55e', '#0d9488', '#3b82f6', '#8b5cf6'],
  // Row 3: Light colors
  ['#fecaca', '#fed7aa', '#fef08a', '#bbf7d0', '#99f6e4', '#bfdbfe', '#ddd6fe'],
];

/** Hex color validation pattern */
const HEX_PATTERN = /^#[0-9A-Fa-f]{0,6}$/;

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  const handleColorSelect = useCallback(
    (color: string) => {
      onChange(color);
      setIsOpen(false);
    },
    [onChange]
  );

  const handleHexInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      if (HEX_PATTERN.test(val)) {
        onChange(val);
      }
    },
    [onChange]
  );

  const isSelected = (color: string) => value.toLowerCase() === color.toLowerCase();

  return (
    <div ref={containerRef} className="relative">
      {/* Color Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full h-10 rounded-xl border-2 border-[var(--color-border)] hover:border-[var(--color-border-focus)] transition-colors"
        style={{ backgroundColor: value }}
      />

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-12 left-0 z-50 p-2.5 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] shadow-xl min-w-[200px]">
          {/* Color Grid */}
          <div className="space-y-1.5 mb-2">
            {COLOR_PALETTE.map((row, rowIdx) => (
              <div key={rowIdx} className="flex gap-1">
                {row.map((color) => (
                  <button
                    key={color}
                    onClick={() => handleColorSelect(color)}
                    className={`w-6 h-6 rounded-md transition-transform hover:scale-110 ${
                      isSelected(color)
                        ? 'ring-2 ring-[var(--color-accent)] ring-offset-1 ring-offset-[var(--color-bg-secondary)]'
                        : ''
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            ))}
          </div>

          {/* Custom Input */}
          <div className="flex items-center gap-1.5 pt-2 border-t border-[var(--color-border)]">
            <input
              type="color"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="w-8 h-8 cursor-pointer bg-transparent border-0 rounded-lg"
            />
            <input
              type="text"
              value={value.toUpperCase()}
              onChange={handleHexInput}
              className="flex-1 px-2 py-1.5 text-xs font-mono bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
              maxLength={7}
            />
          </div>
        </div>
      )}
    </div>
  );
}

