import type { ReadingPreferences } from '../types/learning';
import { getLineHeightValue, getReadingFontClass } from '../utils/textMetrics';

interface AccessibleReaderBoxProps {
  text: string;
  preferences: ReadingPreferences;
  label?: string;
  testId?: string;
}

export function AccessibleReaderBox({
  text,
  preferences,
  label,
  testId,
}: AccessibleReaderBoxProps) {
  const lineHeight = getLineHeightValue(preferences.lineSpacing);
  const fontClass = getReadingFontClass(preferences.fontFamily);
  const hc = preferences.highContrast;

  return (
    <div
      className={
        hc
          ? 'rounded-xl border-2 border-yellow-300 bg-black p-6 text-white'
          : 'rounded-xl border border-slate-200 bg-white p-6 text-slate-900'
      }
    >
      {label && (
        <p
          className={`mb-3 text-xs font-semibold ${
            hc ? 'text-yellow-300' : 'text-slate-500'
          }`}
        >
          {label}
        </p>
      )}
      <div
        data-testid={testId}
        className={`whitespace-pre-wrap ${fontClass} ${
          hc ? 'text-white' : 'text-slate-900'
        }`}
        style={{
          fontSize: `${preferences.fontSize}px`,
          lineHeight,
        }}
      >
        {text}
      </div>
    </div>
  );
}
