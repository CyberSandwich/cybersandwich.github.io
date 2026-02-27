/**
 * Barcode Generator Component - Side panel layout
 */

import { useState, useCallback } from 'react';
import { useBarcode } from '../hooks/useBarcode';
import { useDebounce } from '../hooks/useDebounce';
import { useCopyImage } from '../hooks/useCopyImage';
import { ColorPicker } from './ColorPicker';
import { CopyFeedback } from './CopyFeedback';
import { ActionButtons } from './ActionButtons';
import { ButtonGroup } from './ButtonGroup';
import { SliderControl } from './SliderControl';
import { Icon } from './Icon';
import {
  BARCODE_FORMATS,
  BARCODE_SIZE_PRESETS,
  DEFAULT_BARCODE_WIDTH,
  DEFAULT_BARCODE_HEIGHT,
  DEFAULT_BARCODE_STYLE,
  DEFAULT_BARCODE_DATA,
  DEFAULT_MARGIN,
  FORMAT_OPTIONS,
  FONT_OPTIONS,
} from '../constants';
import { ICON_CLOSE, ICON_INFO, ICON_TEXT_LINES, ICON_CHECK } from '../constants/ui-icons';
import type { BarcodeFormat, BarcodeStyleOptions, ExportFormat } from '../types';
import { renderBarcodeToCanvas } from '../utils/barcodeRender';
import { exportCanvas } from '../utils/download';

interface BarcodeGeneratorProps {
  data: string;
  onDataChange: (data: string) => void;
}

export function BarcodeGenerator({ data, onDataChange }: BarcodeGeneratorProps) {
  const [format, setFormat] = useState<BarcodeFormat>('CODE128');
  const [width, setWidth] = useState(DEFAULT_BARCODE_WIDTH);
  const [height, setHeight] = useState(DEFAULT_BARCODE_HEIGHT);
  const [style, setStyle] = useState<BarcodeStyleOptions>({ ...DEFAULT_BARCODE_STYLE });
  const [selectedPreset, setSelectedPreset] = useState(3); // XL default
  const [customExportWidth, setCustomExportWidth] = useState('');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png');
  const [showOptions, setShowOptions] = useState(false);
  const [showFormatInfo, setShowFormatInfo] = useState(false);
  const { copySuccess, copyError, copyToClipboard } = useCopyImage();
  const debouncedData = useDebounce(data, 300);

  // Use immediate data if it's a format placeholder (just switched formats)
  // Otherwise use debounced data for smooth typing experience
  const isPlaceholder = BARCODE_FORMATS.some(f => f.placeholder === data.trim());
  const displayData = isPlaceholder ? data.trim() : (debouncedData.trim() || DEFAULT_BARCODE_DATA);

  const { svgRef, isValid, error } = useBarcode({
    data: displayData,
    format,
    width,
    height,
    style,
  });

  // Get current format config for info display
  const currentFormatConfig = BARCODE_FORMATS.find((f) => f.value === format);


  const handleStyleChange = useCallback(
    <K extends keyof BarcodeStyleOptions>(key: K, value: BarcodeStyleOptions[K]) => {
      setStyle((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const handleFormatChange = useCallback(
    (newFormat: BarcodeFormat) => {
      setFormat(newFormat);
      // Always reset to the new format's demo data when switching formats
      // This ensures consistent behavior and avoids validation confusion
      const formatConfig = BARCODE_FORMATS.find((f) => f.value === newFormat);
      onDataChange(formatConfig?.placeholder ?? '');
    },
    [onDataChange]
  );

  // Get export dimensions (custom or preset)
  const getExportDimensions = useCallback(() => {
    if (customExportWidth) {
      const w = parseInt(customExportWidth) || BARCODE_SIZE_PRESETS[selectedPreset].width;
      // Maintain aspect ratio from preset
      const preset = BARCODE_SIZE_PRESETS[selectedPreset];
      const h = Math.round(w * (preset.height / preset.width));
      return { width: w, height: h };
    }
    return BARCODE_SIZE_PRESETS[selectedPreset];
  }, [customExportWidth, selectedPreset]);

  const handleExport = useCallback(async () => {
    if (!isValid) return;
    const currentData = data.trim() || DEFAULT_BARCODE_DATA;
    const { width: exportWidth } = getExportDimensions();
    try {
      const canvas = await renderBarcodeToCanvas({
        data: currentData, format, targetWidth: exportWidth,
        previewBarWidth: width, previewBarHeight: height, margin: DEFAULT_MARGIN, style,
      });
      exportCanvas(canvas, exportFormat, 'barcode');
    } catch (err) {
      console.error('Failed to export:', err);
    }
  }, [data, isValid, getExportDimensions, exportFormat, format, width, height, style]);

  const handleCopy = useCallback(() => {
    if (!isValid) return;
    const currentData = data.trim() || DEFAULT_BARCODE_DATA;
    const { width: exportWidth } = getExportDimensions();
    copyToClipboard(() =>
      renderBarcodeToCanvas({
        data: currentData,
        format,
        targetWidth: exportWidth,
        previewBarWidth: width,
        previewBarHeight: height,
        margin: DEFAULT_MARGIN,
        style,
      })
    );
  }, [data, isValid, getExportDimensions, format, width, height, style, copyToClipboard]);

  const handleReset = useCallback(() => {
    setWidth(DEFAULT_BARCODE_WIDTH);
    setHeight(DEFAULT_BARCODE_HEIGHT);
    setStyle({ ...DEFAULT_BARCODE_STYLE });
    setSelectedPreset(3);
    setCustomExportWidth('');
    setExportFormat('png');
  }, []);

  return (
    <div className="flex-1 flex items-center justify-center overflow-visible relative">
      {/* Options Panel - Bottom on mobile, left side on desktop */}
      <div
        className={`fixed lg:absolute z-20 transition-all duration-200 ease-out
          bottom-0 left-0 right-0 lg:bottom-auto lg:left-4 lg:right-auto lg:top-1/2
          ${showOptions
            ? 'opacity-100 translate-y-0 lg:-translate-y-1/2 lg:translate-x-0'
            : 'opacity-0 translate-y-full lg:-translate-y-1/2 lg:-translate-x-8 pointer-events-none'
          }`}
      >
          <div className="w-full lg:w-[280px] space-y-5 p-5 rounded-t-2xl lg:rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] max-h-[60vh] lg:max-h-none overflow-y-auto">
            {/* Mobile Header */}
            <div className="flex justify-between items-center lg:hidden -mt-1 -mb-2">
              <span className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">Options</span>
              <button
                onClick={() => setShowOptions(false)}
                className="p-1 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              >
                <Icon path={ICON_CLOSE} />
              </button>
            </div>
            {/* Colors */}
            <div className="space-y-3">
              <span className="text-xs text-[var(--color-text-muted)]">Color</span>
              <div className="flex gap-2">
                <div className="flex-1">
                  <ColorPicker
                    value={style.lineColor}
                    onChange={(color) => handleStyleChange('lineColor', color)}
                  />
                </div>
                <div className="flex-1">
                  <ColorPicker
                    value={style.bgColor}
                    onChange={(color) => handleStyleChange('bgColor', color)}
                  />
                </div>
              </div>
            </div>

            {/* Bar Dimensions */}
            <SliderControl
              label="Bar Width"
              value={width}
              onChange={setWidth}
              min={1}
              max={4}
              step={0.5}
              formatValue={(v) => v.toFixed(1)}
            />

            <SliderControl
              label="Height"
              value={height}
              onChange={setHeight}
              min={40}
              max={200}
              step={10}
              formatValue={(v) => `${v}px`}
            />

            {/* Text Font (greyed out when text not displayed) */}
            <div className={`space-y-3 transition-opacity ${!style.displayValue ? 'opacity-30 pointer-events-none' : ''}`}>
              <span className="text-xs text-[var(--color-text-muted)]">Font</span>
              <ButtonGroup
                options={FONT_OPTIONS}
                value={style.font}
                onChange={(v) => handleStyleChange('font', v)}
              />
            </div>
            <SliderControl
              label="Font Size"
              value={style.fontSize}
              onChange={(v) => handleStyleChange('fontSize', v)}
              min={10}
              max={24}
              step={1}
              formatValue={(v) => `${v}px`}
              disabled={!style.displayValue}
            />

            {/* Export Size */}
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-xs text-[var(--color-text-muted)]">Export</span>
                <span className="text-xs text-[var(--color-text-muted)]">{customExportWidth || BARCODE_SIZE_PRESETS[selectedPreset].width}px</span>
              </div>
              <div className="flex gap-1">
                {BARCODE_SIZE_PRESETS.map((preset, index) => (
                  <button
                    key={preset.label}
                    onClick={() => { setSelectedPreset(index); setCustomExportWidth(''); }}
                    className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${
                      selectedPreset === index && !customExportWidth
                        ? 'bg-[var(--color-accent)] text-white'
                        : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
                <input
                  type="text"
                  value={customExportWidth}
                  onChange={(e) => setCustomExportWidth(e.target.value.replace(/\D/g, ''))}
                  placeholder="Custom"
                  className={`w-16 py-2 px-2 text-xs text-center rounded-lg transition-all ${
                    customExportWidth
                      ? 'bg-[var(--color-accent)] text-white placeholder:text-white/60'
                      : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] placeholder:text-[var(--color-text-muted)]'
                  }`}
                />
              </div>
            </div>

            {/* Format */}
            <div className="space-y-3">
              <span className="text-xs text-[var(--color-text-muted)]">Format</span>
              <ButtonGroup
                options={FORMAT_OPTIONS}
                value={exportFormat}
                onChange={setExportFormat}
                uppercase
              />
            </div>

            {/* Reset */}
            <div className="pt-2 border-t border-[var(--color-border)]">
              <button
                onClick={handleReset}
                className="w-full py-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                Reset to defaults
              </button>
            </div>
          </div>
      </div>

      {/* Main Content - Centered */}
      <div className="flex flex-col items-center gap-6">
          {/* Preview */}
          <div
            className="w-[280px] sm:w-[360px] lg:w-[420px] h-[160px] lg:h-[200px] rounded-2xl flex items-center justify-center p-6 transition-colors shadow-xl overflow-hidden"
            style={{ backgroundColor: style.bgColor }}
          >
            {error && (
              <div className="text-[var(--color-error)] text-sm text-center px-4">{error}</div>
            )}
            <div className={`flex items-start justify-center ${error ? 'hidden' : ''}`} style={{ height: height + 30 }}>
              <svg ref={svgRef} className="block max-w-full shrink-0" />
            </div>
          </div>

          {/* Format Select + Text Toggle + Info */}
          <div className="flex gap-3 w-full max-w-[320px]">
            <select
              value={format}
              onChange={(e) => handleFormatChange(e.target.value as BarcodeFormat)}
              className="flex-1 px-4 py-3 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-2xl text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none cursor-pointer text-base"
            >
              {BARCODE_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => handleStyleChange('displayValue', !style.displayValue)}
              className={`h-12 px-4 rounded-2xl transition-all flex items-center justify-center ${
                style.displayValue
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
              }`}
              title={style.displayValue ? 'Hide text' : 'Show text'}
            >
              <Icon path={ICON_TEXT_LINES} />
            </button>
            <div className="relative">
              <button
                onClick={() => setShowFormatInfo(!showFormatInfo)}
                className={`h-12 px-4 rounded-2xl transition-all flex items-center justify-center ${
                  showFormatInfo
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                }`}
                title="Format requirements"
              >
                <Icon path={ICON_INFO} />
              </button>
              {showFormatInfo && currentFormatConfig && (
                <div className="absolute bottom-full right-0 mb-2 w-48 p-3 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-xl shadow-lg z-30">
                  <div className="text-xs font-medium text-[var(--color-text-primary)] mb-1">{currentFormatConfig.label}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">{currentFormatConfig.description}</div>
                  <div className="text-xs text-[var(--color-text-muted)] mt-2">Example: <span className="font-mono text-[var(--color-text-secondary)]">{currentFormatConfig.placeholder}</span></div>
                </div>
              )}
            </div>
          </div>

          {/* Input with validation indicator */}
          <div className="w-full max-w-[320px]">
            <div className="relative">
              <input
                type="text"
                value={data}
                onChange={(e) => onDataChange(e.target.value)}
                placeholder={currentFormatConfig?.placeholder}
                className={`w-full px-4 py-3 pr-10 bg-[var(--color-bg-secondary)] border rounded-2xl text-[var(--color-text-primary)] focus:outline-none font-mono text-base transition-colors ${
                  data.trim()
                    ? !error && isValid
                      ? 'border-green-500/50 focus:border-green-500'
                      : 'border-red-500/50 focus:border-red-500'
                    : 'border-[var(--color-border)] focus:border-[var(--color-accent)]'
                }`}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center">
                {data.trim() && (
                  !error && isValid
                    ? <Icon path={ICON_CHECK} className="w-5 h-5 text-green-500" />
                    : <Icon path={ICON_CLOSE} className="w-5 h-5 text-red-500" />
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <ActionButtons
            showOptions={showOptions}
            onToggleOptions={() => setShowOptions(!showOptions)}
            onCopy={handleCopy}
            onExport={handleExport}
            copyDisabled={!isValid || !debouncedData.trim()}
            exportDisabled={!isValid || !debouncedData.trim()}
          />
      </div>

      <CopyFeedback success={copySuccess} error={copyError} />
    </div>
  );
}

