/**
 * Reusable slider control with label and value display
 */

interface SliderControlProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  formatValue?: (value: number) => string;
  disabled?: boolean;
}

export function SliderControl({
  label,
  value,
  onChange,
  min,
  max,
  step,
  formatValue = (v) => String(v),
  disabled = false,
}: SliderControlProps) {
  return (
    <div className={`space-y-3 transition-opacity ${disabled ? 'opacity-30 pointer-events-none' : ''}`}>
      <div className="flex justify-between">
        <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
        <span className="text-xs text-[var(--color-text-muted)]">{formatValue(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  );
}
