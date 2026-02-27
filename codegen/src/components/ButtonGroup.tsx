/**
 * Reusable button group for option selection
 */

interface ButtonGroupOption<T> {
  value: T;
  label: string;
}

interface ButtonGroupProps<T> {
  options: readonly ButtonGroupOption<T>[];
  value: T;
  onChange: (value: T) => void;
  uppercase?: boolean;
  compact?: boolean;
}

export function ButtonGroup<T extends string | number>({
  options,
  value,
  onChange,
  uppercase = false,
  compact = false,
}: ButtonGroupProps<T>) {
  const paddingClass = compact ? 'py-1.5' : 'py-2';

  return (
    <div className="flex gap-1">
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          onClick={() => onChange(opt.value)}
          className={`flex-1 ${paddingClass} text-xs font-medium rounded-lg transition-all ${uppercase ? 'uppercase' : ''} ${
            value === opt.value
              ? 'bg-[var(--color-accent)] text-white'
              : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-primary)]'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
