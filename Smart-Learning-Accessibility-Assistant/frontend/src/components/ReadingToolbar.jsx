import { Contrast, RotateCcw } from 'lucide-react';
import {
  clampFontSize,
  DEFAULT_FONT_SIZE,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
} from '../utils/accessibility';

export function ReadingToolbar({ preferences, onChange }) {
  const hc = preferences.highContrast;

  const updateFontSize = (nextSize) => {
    onChange({
      ...preferences,
      fontSize: clampFontSize(nextSize),
    });
  };

  const updateLineSpacing = (lineSpacing) => {
    onChange({ ...preferences, lineSpacing });
  };

  const updateFontFamily = (fontFamily) => {
    onChange({ ...preferences, fontFamily });
  };

  const toggleHighContrast = () => {
    onChange({ ...preferences, highContrast: !preferences.highContrast });
  };

  const resetDefaults = () => {
    onChange({
      fontSize: DEFAULT_FONT_SIZE,
      lineSpacing: 'relaxed',
      fontFamily: 'sans',
      highContrast: false,
    });
  };

  return (
    <section
      aria-label="Reading accessibility controls"
      className={
        hc
          ? 'rounded-xl border-2 border-white bg-black px-4 py-3.5 text-white'
          : 'rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-slate-900'
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`text-xs font-semibold whitespace-nowrap ${
              hc ? 'text-yellow-300' : 'text-slate-700'
            }`}
          >
            Text Size
          </span>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => updateFontSize(preferences.fontSize - 2)}
              disabled={preferences.fontSize <= MIN_FONT_SIZE}
              aria-label="Decrease text size"
              className={
                hc
                  ? 'inline-flex h-9 items-center justify-center rounded-lg border-2 border-white bg-zinc-900 px-3 text-xs font-bold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-45'
                  : 'inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45'
              }
            >
              A-
            </button>

            <label htmlFor="reading-font-size-slider" className="sr-only">
              Font size in pixels
            </label>
            <input
              id="reading-font-size-slider"
              type="range"
              min={MIN_FONT_SIZE}
              max={MAX_FONT_SIZE}
              step={1}
              value={preferences.fontSize}
              onChange={(e) => updateFontSize(Number(e.target.value))}
              className={`w-24 sm:w-28 cursor-pointer ${
                hc ? 'accent-yellow-300' : 'accent-indigo-600'
              }`}
            />

            <button
              type="button"
              onClick={() => updateFontSize(preferences.fontSize + 2)}
              disabled={preferences.fontSize >= MAX_FONT_SIZE}
              aria-label="Increase text size"
              className={
                hc
                  ? 'inline-flex h-9 items-center justify-center rounded-lg border-2 border-white bg-zinc-900 px-3 text-xs font-bold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-45'
                  : 'inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45'
              }
            >
              A+
            </button>

            <span
              data-testid="font-size-value"
              className={`ml-1 min-w-[3.25rem] text-xs font-semibold font-mono-tabular whitespace-nowrap ${
                hc ? 'text-yellow-300' : 'text-blue-700'
              }`}
            >
              {preferences.fontSize} px
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div
            className={`flex items-center gap-1 rounded-lg p-1 ${
              hc ? 'border border-white bg-zinc-900' : 'bg-slate-100'
            }`}
            role="group"
            aria-label="Line spacing"
          >
            {[
              { id: 'standard', label: 'Standard' },
              { id: 'relaxed', label: 'Relaxed' },
              { id: 'wide', label: 'Wide' },
            ].map((opt) => {
              const active = preferences.lineSpacing === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => updateLineSpacing(opt.id)}
                  aria-pressed={active}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    hc
                      ? active
                        ? 'bg-yellow-300 text-black font-bold'
                        : 'text-white hover:bg-zinc-800'
                      : active
                      ? 'bg-white text-indigo-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <div
            className={`flex items-center gap-1 rounded-lg p-1 ${
              hc ? 'border border-white bg-zinc-900' : 'bg-slate-100'
            }`}
            role="group"
            aria-label="Reading font"
          >
            {[
              { id: 'sans', label: 'Default Sans' },
              { id: 'accessible', label: 'Hyperlegible' },
              { id: 'dyslexia', label: 'Dyslexia Friendly' },
            ].map((opt) => {
              const active = preferences.fontFamily === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => updateFontFamily(opt.id)}
                  aria-pressed={active}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    hc
                      ? active
                        ? 'bg-yellow-300 text-black font-bold'
                        : 'text-white hover:bg-zinc-800'
                      : active
                      ? 'bg-white text-blue-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={toggleHighContrast}
            aria-pressed={hc}
            data-testid="high-contrast-toggle"
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              hc
                ? 'border-2 border-yellow-300 bg-yellow-300 text-black'
                : 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
            }`}
          >
            <Contrast className="h-3.5 w-3.5" aria-hidden="true" />
            <span>High Contrast</span>
          </button>

          <button
            type="button"
            onClick={resetDefaults}
            aria-label="Reset reading typography to default"
            className={
              hc
                ? 'inline-flex h-9 items-center gap-1.5 rounded-lg border-2 border-white bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-800 whitespace-nowrap shrink-0'
                : 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 whitespace-nowrap shrink-0'
            }
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Reset</span>
          </button>
        </div>
      </div>
    </section>
  );
}
