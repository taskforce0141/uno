import { motion } from 'motion/react';
import { FlipSide, UnoCard } from '../../engine/gameTypes';
import {
  CARD_COLOR_STYLES,
  formatCardValueShort,
  getFaceForDisplay,
} from '../../utils/cardUtils';

export function UnoCardView({
  card,
  side,
  playable = false,
  selected = false,
  dimmed = false,
  faceDown = false,
  size = 'md',
  onClick,
}: {
  card?: UnoCard;
  side: FlipSide;
  playable?: boolean;
  selected?: boolean;
  dimmed?: boolean;
  faceDown?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  onClick?: () => void;
}) {
  const sizeClasses = {
    xs: 'w-9 h-14 rounded-lg text-xs',
    sm: 'w-16 h-24 rounded-xl text-base',
    md: 'w-20 h-28 sm:w-24 sm:h-36 rounded-2xl text-xl sm:text-2xl',
    lg: 'w-24 h-36 sm:w-28 sm:h-42 rounded-2xl text-2xl sm:text-3xl',
  };

  if (faceDown || !card) {
    const isDarkSide = side === 'dark';
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        className={`relative select-none ${sizeClasses[size]} p-1.5 shadow-lg border-2 ${
          isDarkSide
            ? 'bg-slate-950 border-fuchsia-500/60'
            : 'bg-slate-900 border-white/80'
        } flex items-center justify-center overflow-hidden transition-transform ${
          onClick ? 'cursor-pointer hover:-translate-y-1 active:scale-95' : 'cursor-default'
        }`}
      >
        <div
          className={`w-full h-full rounded-xl flex items-center justify-center ${
            isDarkSide
              ? 'bg-gradient-to-br from-purple-900 via-slate-900 to-teal-900'
              : 'bg-gradient-to-br from-slate-800 via-slate-900 to-rose-950'
          }`}
        >
          <div className="w-[82%] h-[58%] rounded-full border-2 border-white/25 -rotate-12 flex items-center justify-center bg-rose-600/90 shadow-inner">
            <span className="font-display font-extrabold tracking-tight text-white text-[0.55em] rotate-12">
              UNO
            </span>
          </div>
        </div>
      </button>
    );
  }

  const face = getFaceForDisplay(card, side);
  const style = CARD_COLOR_STYLES[face.color] || CARD_COLOR_STYLES.wild;
  const symbol = formatCardValueShort(face.value);
  const isWild = face.color === 'wild';
  const isDarkFrame = side === 'dark';

  const cornerTextSize =
    size === 'xs'
      ? 'text-[9px]'
      : size === 'sm'
      ? 'text-xs'
      : 'text-xs sm:text-sm';

  const centerTextSize =
    symbol.length > 2
      ? size === 'sm'
        ? 'text-xs'
        : 'text-base sm:text-lg'
      : size === 'lg'
      ? 'text-3xl sm:text-4xl'
      : size === 'md'
      ? 'text-2xl sm:text-3xl'
      : 'text-base';

  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      whileHover={playable || onClick ? { y: -8 } : undefined}
      whileTap={playable || onClick ? { scale: 0.96 } : undefined}
      transition={{ duration: 0.16 }}
      aria-label={`${face.color} ${face.value}`}
      className={`relative select-none ${sizeClasses[size]} p-1 sm:p-1.5 shadow-xl transition-all ${
        isDarkFrame
          ? 'bg-slate-950 border-2 border-slate-700'
          : 'bg-white border-2 border-white'
      } ${
        selected
          ? 'ring-4 ring-amber-400 -translate-y-4 z-20'
          : playable
          ? 'ring-2 ring-white/90 shadow-rose-500/20 cursor-pointer'
          : onClick
          ? 'cursor-pointer'
          : 'cursor-default'
      } ${dimmed ? 'opacity-45 saturate-75' : 'opacity-100'}`}
    >
      <div
        className={`relative w-full h-full rounded-[10px] sm:rounded-xl bg-gradient-to-br ${style.bgDarker} overflow-hidden flex items-center justify-center`}
      >
        {/* Wild quadrant background */}
        {isWild && (
          <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 opacity-90">
            <div className={side === 'dark' ? 'bg-[#DB2777]' : 'bg-[#E11D48]'} />
            <div className={side === 'dark' ? 'bg-[#0D9488]' : 'bg-[#2563EB]'} />
            <div className={side === 'dark' ? 'bg-[#EA580C]' : 'bg-[#EAB308]'} />
            <div className={side === 'dark' ? 'bg-[#7C3AED]' : 'bg-[#16A34A]'} />
          </div>
        )}

        {/* Top-left corner index */}
        <span
          className={`absolute top-1 left-1.5 font-display font-extrabold text-white drop-shadow ${cornerTextSize} leading-none z-10`}
        >
          {symbol}
        </span>

        {/* Center white/dark oval */}
        <div
          className={`relative z-10 w-[78%] h-[62%] rounded-[999px] -rotate-12 flex items-center justify-center shadow-md ${
            isDarkFrame ? 'bg-slate-950/90 border border-white/20' : 'bg-white/95'
          }`}
        >
          <span
            className={`font-display font-extrabold rotate-12 tracking-tight ${centerTextSize} ${
              isDarkFrame
                ? 'text-white'
                : isWild
                ? 'text-slate-900'
                : style.text
            }`}
          >
            {symbol}
          </span>
        </div>

        {/* Bottom-right corner index */}
        <span
          className={`absolute bottom-1 right-1.5 font-display font-extrabold text-white drop-shadow rotate-180 ${cornerTextSize} leading-none z-10`}
        >
          {symbol}
        </span>
      </div>
    </motion.button>
  );
}
