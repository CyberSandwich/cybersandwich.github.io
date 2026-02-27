/**
 * QR Code Generator Component - Side panel layout
 */

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useQRCode } from '../hooks/useQRCode';
import { useDebounce } from '../hooks/useDebounce';
import { useCopyImage } from '../hooks/useCopyImage';
import { ColorPicker } from './ColorPicker';
import { CopyFeedback } from './CopyFeedback';
import { ActionButtons } from './ActionButtons';
import { ButtonGroup } from './ButtonGroup';
import { Icon } from './Icon';
import { ERROR_CORRECTION_OPTIONS, DEFAULT_MARGIN, DEFAULT_QR_STYLE, DEFAULT_QR_DATA, FORMAT_OPTIONS, QR_SIZE_PRESETS } from '../constants';
import { ICON_LIBRARY, createIconBlobUrl } from '../constants/icons';
import { ICON_CLOSE, ICON_IMAGE, ICON_CHECKERBOARD } from '../constants/ui-icons';
import type { QRErrorCorrectionLevel, QRStyleOptions, ExportFormat } from '../types';
import { renderQRToCanvas } from '../utils/qrRender';
import { exportCanvas } from '../utils/download';

interface QRGeneratorProps {
  data: string;
  onDataChange: (data: string) => void;
}

export function QRGenerator({ data, onDataChange }: QRGeneratorProps) {
  const [errorCorrection, setErrorCorrection] = useState<QRErrorCorrectionLevel>('H');
  const [style, setStyle] = useState<QRStyleOptions>({ ...DEFAULT_QR_STYLE });
  const [exportSize, setExportSize] = useState(1024);
  const [customSize, setCustomSize] = useState('');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png');
  const [showOptions, setShowOptions] = useState(false);
  const [customLogoSrc, setCustomLogoSrc] = useState<string | null>(null);
  const [selectedIcon, setSelectedIcon] = useState('none');
  const [transparentBg, setTransparentBg] = useState(false);
  const [margin, setMargin] = useState(DEFAULT_MARGIN);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevBlobUrlRef = useRef<string | null>(null);
  const { copySuccess, copyError, copyToClipboard } = useCopyImage();

  const debouncedData = useDebounce(data, 300);
  const displayData = debouncedData.trim() || DEFAULT_QR_DATA;

  // Compute effective logo source with proper blob URL cleanup
  const effectiveLogoSrc = useMemo(() => {
    if (selectedIcon === 'none') return null;
    if (selectedIcon === 'custom') return customLogoSrc;
    const icon = ICON_LIBRARY.find(i => i.id === selectedIcon);
    if (icon?.svg) {
      return createIconBlobUrl(icon.svg, style.fgColor);
    }
    return null;
  }, [selectedIcon, customLogoSrc, style.fgColor]);

  // Cleanup blob URLs when they change (prevents memory leaks)
  useEffect(() => {
    const prevUrl = prevBlobUrlRef.current;
    // Revoke previous blob URL if it was a library icon (not custom upload)
    if (prevUrl && prevUrl.startsWith('blob:') && selectedIcon !== 'custom') {
      URL.revokeObjectURL(prevUrl);
    }
    prevBlobUrlRef.current = effectiveLogoSrc;
  }, [effectiveLogoSrc, selectedIcon]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const url = prevBlobUrlRef.current;
      if (url?.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  const { canvasRef } = useQRCode({
    data: displayData,
    size: 320,
    margin,
    errorCorrection,
    style,
    logo: effectiveLogoSrc,
    transparentBg,
  });

  const handleStyleChange = useCallback(
    <K extends keyof QRStyleOptions>(key: K, value: QRStyleOptions[K]) => {
      setStyle((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const getEffectiveSize = useCallback(() => {
    return customSize ? parseInt(customSize) || exportSize : exportSize;
  }, [customSize, exportSize]);

  const handleExport = useCallback(async () => {
    const currentData = data.trim() || DEFAULT_QR_DATA;
    const canvas = await renderQRToCanvas({
      data: currentData, size: getEffectiveSize(), margin, errorCorrection, style, logo: effectiveLogoSrc, transparentBg,
    });
    exportCanvas(canvas, exportFormat, 'qrcode');
  }, [data, getEffectiveSize, exportFormat, margin, errorCorrection, style, effectiveLogoSrc, transparentBg]);

  const handleCopy = useCallback(() => {
    const currentData = data.trim() || DEFAULT_QR_DATA;
    copyToClipboard(() =>
      renderQRToCanvas({ data: currentData, size: getEffectiveSize(), margin, errorCorrection, style, logo: effectiveLogoSrc, transparentBg })
    );
  }, [data, getEffectiveSize, margin, errorCorrection, style, effectiveLogoSrc, transparentBg, copyToClipboard]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setCustomLogoSrc(ev.target?.result as string);
        setSelectedIcon('custom');
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  }, []);

  const handleIconSelect = useCallback((iconId: string) => {
    setSelectedIcon(iconId);
    if (iconId === 'none') {
      setCustomLogoSrc(null);
    }
  }, []);

  const handleReset = useCallback(() => {
    setErrorCorrection('H');
    setStyle({ ...DEFAULT_QR_STYLE });
    setExportSize(1024);
    setCustomSize('');
    setExportFormat('png');
    setCustomLogoSrc(null);
    setSelectedIcon('none');
    setTransparentBg(false);
    setMargin(DEFAULT_MARGIN);
  }, []);


  // Icon SVG content is from hardcoded ICON_LIBRARY constants, not user input - safe to render
  const renderIcon = (svg: string | null) => (
    <div className="w-3.5 h-3.5" dangerouslySetInnerHTML={{ __html: svg || '' }} />
  );

  return (
    <div className="flex-1 flex items-center justify-center overflow-visible relative">
      {/* Options Panel - Bottom sheet on mobile, left side on desktop */}
      <div
        className={`fixed lg:absolute z-20 transition-all duration-200 ease-out
          bottom-0 left-0 right-0 lg:bottom-auto lg:left-4 lg:right-auto lg:top-1/2
          ${showOptions
            ? 'opacity-100 translate-y-0 lg:-translate-y-1/2 lg:translate-x-0'
            : 'opacity-0 translate-y-full lg:-translate-y-1/2 lg:-translate-x-8 pointer-events-none'
          }`}
      >
          <div className="w-full lg:w-[300px] p-4 rounded-t-2xl lg:rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] max-h-[60vh] lg:max-h-none overflow-y-auto overflow-visible">
            {/* Mobile Header */}
            <div className="flex justify-between items-center mb-4 lg:hidden">
              <span className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">Options</span>
              <button
                onClick={() => setShowOptions(false)}
                className="p-1 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              >
                <Icon path={ICON_CLOSE} />
              </button>
            </div>
            {/* Size Section */}
            <div className="mb-4">
              <div className="flex justify-between mb-1.5">
                <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-medium">Size</span>
                <span className="text-[10px] text-[var(--color-text-muted)]">{customSize || exportSize}px</span>
              </div>
              <div className="flex gap-1">
                {QR_SIZE_PRESETS.map((opt) => (
                  <button
                    key={opt.label}
                    onClick={() => { setExportSize(opt.value); setCustomSize(''); }}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${
                      exportSize === opt.value && !customSize
                        ? 'bg-[var(--color-accent)] text-white'
                        : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-primary)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
                <input
                  type="text"
                  value={customSize}
                  onChange={(e) => setCustomSize(e.target.value.replace(/\D/g, ''))}
                  placeholder="Custom"
                  className={`w-16 py-1.5 px-2 text-xs text-center rounded-lg transition-all ${
                    customSize
                      ? 'bg-[var(--color-accent)] text-white placeholder:text-white/60'
                      : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] placeholder:text-[var(--color-text-muted)]'
                  }`}
                />
              </div>
            </div>

            {/* Format Section */}
            <div className="mb-4">
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5 font-medium">Format</div>
              <ButtonGroup
                options={FORMAT_OPTIONS}
                value={exportFormat}
                onChange={setExportFormat}
                uppercase
                compact
              />
            </div>

            {/* Divider */}
            <div className="border-t border-[var(--color-border)] my-4" />

            {/* Colors Section */}
            <div className="mb-4">
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-2 font-medium">Colors</div>
              <div className="flex gap-2 items-center overflow-visible">
                <div className="flex-1 overflow-visible">
                  <ColorPicker value={style.fgColor} onChange={(color) => handleStyleChange('fgColor', color)} />
                </div>
                {!transparentBg && (
                  <div className="flex-1 overflow-visible">
                    <ColorPicker value={style.bgColor} onChange={(color) => handleStyleChange('bgColor', color)} />
                  </div>
                )}
                <button
                  onClick={() => setTransparentBg(!transparentBg)}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all shrink-0 ${
                    transparentBg
                      ? 'bg-[var(--color-accent)] text-white'
                      : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]'
                  }`}
                  title="Transparent background"
                >
                  <Icon path={ICON_CHECKERBOARD} className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-[var(--color-border)] my-4" />

            {/* Margin Section */}
            <div className="mb-4">
              <div className="flex justify-between mb-1.5">
                <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-medium">Margin</span>
                <span className="text-[10px] text-[var(--color-text-muted)]">{margin}px</span>
              </div>
              <input
                type="range"
                min={0}
                max={48}
                step={4}
                value={margin}
                onChange={(e) => setMargin(Number(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none bg-[var(--color-bg-tertiary)] cursor-pointer"
              />
            </div>

            {/* Redundancy Section */}
            <div className="mb-4">
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5 font-medium">Redundancy</div>
              <ButtonGroup
                options={ERROR_CORRECTION_OPTIONS}
                value={errorCorrection}
                onChange={setErrorCorrection}
                compact
              />
            </div>

            {/* Divider */}
            <div className="border-t border-[var(--color-border)] my-4" />

            {/* Logo Section */}
            <div className="mb-4">
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-2 font-medium">Logo</div>
              <div className="flex gap-1.5 flex-wrap">
                {/* None button */}
                <button
                  onClick={() => handleIconSelect('none')}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all text-xs ${
                    selectedIcon === 'none'
                      ? 'bg-[var(--color-accent)] text-white'
                      : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-primary)]'
                  }`}
                >
                  <Icon path={ICON_CLOSE} className="w-3.5 h-3.5" />
                </button>
                {/* Custom upload button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                    selectedIcon === 'custom'
                      ? 'bg-[var(--color-accent)] text-white'
                      : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-primary)]'
                  }`}
                >
                  <Icon path={ICON_IMAGE} className="w-3.5 h-3.5" />
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
                {/* Icon options - SVG content from hardcoded ICON_LIBRARY, safe to render */}
                {ICON_LIBRARY.filter(i => i.id !== 'none').map((icon) => (
                  <button
                    key={icon.id}
                    onClick={() => handleIconSelect(icon.id)}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                      selectedIcon === icon.id
                        ? 'bg-[var(--color-accent)] text-white'
                        : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-primary)]'
                    }`}
                    title={icon.label}
                  >
                    {renderIcon(icon.svg)}
                  </button>
                ))}
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-[var(--color-border)] my-4" />

            {/* Reset */}
            <button
              onClick={handleReset}
              className="w-full py-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              Reset to defaults
            </button>
          </div>
      </div>

      {/* Main Content - Centered */}
      <div className="flex flex-col items-center gap-6">
          {/* Preview */}
          <div
            className="w-[240px] h-[240px] sm:w-[280px] sm:h-[280px] lg:w-[320px] lg:h-[320px] rounded-2xl flex items-center justify-center p-4 transition-colors shadow-xl"
            style={{ backgroundColor: transparentBg ? '#e5e5e5' : style.bgColor }}
          >
            <canvas ref={canvasRef} className="block w-full h-full" />
          </div>

          {/* Input */}
          <textarea
            value={data}
            onChange={(e) => onDataChange(e.target.value)}
            rows={2}
            className="w-full max-w-[320px] px-4 py-3 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-2xl text-[var(--color-text-primary)] resize-none focus:border-[var(--color-accent)] focus:outline-none text-base text-center"
          />

          {/* Actions */}
          <ActionButtons
            showOptions={showOptions}
            onToggleOptions={() => setShowOptions(!showOptions)}
            onCopy={handleCopy}
            onExport={handleExport}
          />
      </div>

      <CopyFeedback success={copySuccess} error={copyError} />
    </div>
  );
}

