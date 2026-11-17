import { CardColor, FlipSide } from '../../engine/gameTypes';
import { getColorsForSide } from '../../engine/flipUno';
import { CARD_COLOR_STYLES } from '../../utils/cardUtils';

export function ColorPickerModal({
  open,
  side,
  onSelect,
  onCancel,
}: {
  open: boolean;
  side: FlipSide;
  onSelect: (color: CardColor) => void;
  onCancel?: () => void;
}) {
  if (!open) return null;
  const colors = getColorsForSide(side);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
      <div className="max-w-sm w-full rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-5 shadow-2xl">
        <div className="space-y-1 text-center">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">
            Choose Active Color
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Select the next color for the {side === 'dark' ? 'Dark' : 'Light'} Side
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {colors.map((c) => {
            const style = CARD_COLOR_STYLES[c];
            return (
              <button
                key={c}
                type="button"
                onClick={() => onSelect(c)}
                className={`h-20 rounded-2xl bg-gradient-to-br ${style.bgDarker} text-white font-display font-bold text-lg shadow-lg hover:scale-[1.02] active:scale-95 transition-transform flex items-center justify-center`}
              >
                {style.label}
              </button>
            );
          })}
        </div>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="w-full py-2 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
