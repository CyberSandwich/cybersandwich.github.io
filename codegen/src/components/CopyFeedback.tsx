/**
 * Copy feedback toast component
 */

interface CopyFeedbackProps {
  success: boolean;
  error: boolean;
}

export function CopyFeedback({ success, error }: CopyFeedbackProps) {
  if (!success && !error) return null;

  return (
    <div
      className={`fixed bottom-6 right-6 px-4 py-2 text-white text-sm rounded-xl shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200 ${
        success ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-error)]'
      }`}
    >
      {success ? 'Copied to clipboard' : 'Copy failed - use HTTPS or download instead'}
    </div>
  );
}
