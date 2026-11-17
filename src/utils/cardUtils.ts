import { CardColor, CardFace, FlipSide, UnoCard } from '../engine/gameTypes';

export interface ColorStyle {
  bg: string;
  bgDarker: string;
  ring: string;
  text: string;
  label: string;
  hex: string;
}

export const CARD_COLOR_STYLES: Record<CardColor | 'wild', ColorStyle> = {
  red: {
    bg: 'bg-[#E11D48]',
    bgDarker: 'from-[#F43F5E] to-[#BE123C]',
    ring: 'ring-rose-400',
    text: 'text-[#E11D48]',
    label: 'Red',
    hex: '#E11D48',
  },
  blue: {
    bg: 'bg-[#2563EB]',
    bgDarker: 'from-[#3B82F6] to-[#1D4ED8]',
    ring: 'ring-blue-400',
    text: 'text-[#2563EB]',
    label: 'Blue',
    hex: '#2563EB',
  },
  green: {
    bg: 'bg-[#16A34A]',
    bgDarker: 'from-[#22C55E] to-[#15803D]',
    ring: 'ring-emerald-400',
    text: 'text-[#16A34A]',
    label: 'Green',
    hex: '#16A34A',
  },
  yellow: {
    bg: 'bg-[#EAB308]',
    bgDarker: 'from-[#FACC15] to-[#CA8A04]',
    ring: 'ring-amber-300',
    text: 'text-[#CA8A04]',
    label: 'Yellow',
    hex: '#EAB308',
  },
  pink: {
    bg: 'bg-[#DB2777]',
    bgDarker: 'from-[#EC4899] to-[#9D174D]',
    ring: 'ring-pink-400',
    text: 'text-[#DB2777]',
    label: 'Pink',
    hex: '#DB2777',
  },
  teal: {
    bg: 'bg-[#0D9488]',
    bgDarker: 'from-[#14B8A6] to-[#115E59]',
    ring: 'ring-teal-400',
    text: 'text-[#0D9488]',
    label: 'Teal',
    hex: '#0D9488',
  },
  orange: {
    bg: 'bg-[#EA580C]',
    bgDarker: 'from-[#F97316] to-[#C2410C]',
    ring: 'ring-orange-400',
    text: 'text-[#EA580C]',
    label: 'Orange',
    hex: '#EA580C',
  },
  purple: {
    bg: 'bg-[#7C3AED]',
    bgDarker: 'from-[#8B5CF6] to-[#5B21B6]',
    ring: 'ring-violet-400',
    text: 'text-[#7C3AED]',
    label: 'Purple',
    hex: '#7C3AED',
  },
  wild: {
    bg: 'bg-[#1E293B]',
    bgDarker: 'from-[#334155] to-[#0F172A]',
    ring: 'ring-slate-300',
    text: 'text-slate-900',
    label: 'Wild',
    hex: '#1E293B',
  },
};

export function getFaceForDisplay(card: UnoCard, side: FlipSide): CardFace {
  return side === 'dark' && card.dark ? card.dark : card.light;
}

export function formatCardValueShort(value: string): string {
  switch (value) {
    case 'skip':
      return '⊘';
    case 'skip_everyone':
      return '⊘⊘';
    case 'reverse':
      return '⇄';
    case 'draw1':
      return '+1';
    case 'draw2':
      return '+2';
    case 'wild2':
      return '+2';
    case 'wild4':
      return '+4';
    case 'draw5':
      return '+5';
    case 'wild':
      return 'W';
    case 'wild_draw_color':
      return '+C';
    case 'flip':
      return 'FLIP';
    default:
      return value;
  }
}

export function formatCardValueName(value: string): string {
  switch (value) {
    case 'skip':
      return 'Skip';
    case 'skip_everyone':
      return 'Skip Everyone';
    case 'reverse':
      return 'Reverse';
    case 'draw1':
      return 'Draw One';
    case 'draw2':
      return 'Draw Two';
    case 'wild2':
      return 'Wild +2';
    case 'wild4':
      return 'Wild +4';
    case 'draw5':
      return 'Draw Five';
    case 'wild':
      return 'Wild';
    case 'wild_draw_color':
      return 'Wild Draw Color';
    case 'flip':
      return 'Flip';
    default:
      return value;
  }
}
