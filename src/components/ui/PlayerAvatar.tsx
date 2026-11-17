import { useState } from 'react';
import { AVATAR_OPTIONS } from '../../engine/gameTypes';

export function PlayerAvatar({
  avatarId,
  username,
  size = 'md',
  active = false,
}: {
  avatarId: string;
  username: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  active?: boolean;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const option = AVATAR_OPTIONS.find((a) => a.id === avatarId) ?? AVATAR_OPTIONS[0];

  const sizeMap = {
    xs: 'w-7 h-7 text-xs',
    sm: 'w-9 h-9 text-xs',
    md: 'w-11 h-11 text-sm',
    lg: 'w-14 h-14 text-base',
    xl: 'w-20 h-20 text-xl',
  };

  const ringClass = active
    ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-slate-900'
    : 'border border-slate-300 dark:border-slate-700';

  if (option.imageUrl && !imgFailed) {
    return (
      <div
        className={`${sizeMap[size]} rounded-xl overflow-hidden shrink-0 bg-slate-800 ${ringClass}`}
      >
        <img
          src={option.imageUrl}
          alt={username}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  const initials = username
    .split(/\s+/)
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || option.initials;

  return (
    <div
      className={`${sizeMap[size]} rounded-xl shrink-0 flex items-center justify-center font-bold text-white bg-gradient-to-br ${option.accent} ${ringClass}`}
      aria-label={username}
    >
      {initials}
    </div>
  );
}
