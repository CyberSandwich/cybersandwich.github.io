/**
 * Reusable Icon component for SVG path rendering
 */

interface IconProps {
  path: string;
  className?: string;
}

/**
 * Renders an SVG icon from a path string
 *
 * @example
 * <Icon path={ICON_CLOSE} className="w-5 h-5" />
 * <Icon path={ICON_CHECK} className="w-4 h-4 text-green-500" />
 */
export function Icon({ path, className = 'w-5 h-5' }: IconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}
