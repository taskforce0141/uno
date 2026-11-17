import React, { useEffect, useState } from 'react';
import { AVATAR_OPTIONS } from '../engine/gameTypes';
import { useAuth } from '../hooks/useAuth';
import { useGame } from '../hooks/useGame';
import { joinRoom, lookupRoomByCode, RoomLookupInfo } from '../services/roomService';
import { sanitizeRoomCode } from '../utils/roomUtils';
import { PlayerAvatar } from '../components/ui/PlayerAvatar';

export function JoinRoom({
  initialCode,
  onJoined,
}: {
  initialCode?: string | null;
  onJoined: (roomId: string) => void;
}) {
  const { user, signInGuest } = useAuth();
  const { attachRoom, addToast } = useGame();

  const [code, setCode] = useState(initialCode ? sanitizeRoomCode(initialCode) : '');
  const [username, setUsername] = useState(user?.username || 'Player');
  const [avatar, setAvatar] = useState(user?.avatar || AVATAR_OPTIONS[1].id);
  const [asSpectator, setAsSpectator] = useState(false);

  const [lookupInfo, setLookupInfo] = useState<RoomLookupInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialCode) {
      setCode(sanitizeRoomCode(initialCode));
    }
  }, [initialCode]);

  useEffect(() => {
    if (user) {
      setUsername(user.username);
      setAvatar(user.avatar);
    }
  }, [user]);

  const handleLookup = async (targetCode: string) => {
    const clean = sanitizeRoomCode(targetCode);
    if (clean.length !== 6) {
      setLookupInfo(null);
      return;
    }
    if (!user) return;
    setChecking(true);
    setError('');
    try {
      const info = await lookupRoomByCode(user.sessionToken, clean);
      setLookupInfo(info);
    } catch (err) {
      setLookupInfo(null);
      setError(err instanceof Error ? err.message : 'Room not found.');
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (code.length === 6 && user) {
      handleLookup(code);
    }
  }, [code, user?.sessionToken]);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (joining) return;
    setError('');
    const cleanCode = sanitizeRoomCode(code);
    if (cleanCode.length !== 6) {
      setError('Enter a valid 6-character room code.');
      return;
    }

    setJoining(true);
    try {
      let activeUser = user;
      if (!activeUser) {
        activeUser = await signInGuest(username, avatar);
      }

      const res = await joinRoom(activeUser.sessionToken, cleanCode, {
        username: username.trim() || activeUser.username,
        avatar,
        asSpectator,
      });

      if (!res || !res.room || !res.room.roomId) {
        throw new Error('Unable to load joined room state.');
      }

      attachRoom(res.room, res.gameState, res.hand);
      addToast(`Joined ${res.room.roomName}`, 'success');
      onJoined(res.room.roomId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join room.');
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-10 sm:py-14">
      <form
        onSubmit={handleJoin}
        className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 sm:p-8 space-y-6 shadow-xl"
      >
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">
            Join Private Room
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Enter the 6-character invitation code shared by your room host.
          </p>
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-sm text-rose-500">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1.5">
            Room Code
          </label>
          <input
            type="text"
            required
            maxLength={6}
            value={code}
            onChange={(e) => {
              const next = sanitizeRoomCode(e.target.value);
              setCode(next);
              if (next.length < 6) {
                setLookupInfo(null);
                setError('');
              }
            }}
            placeholder="ABC123"
            className="w-full px-4 py-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-mono-tabular text-2xl font-bold tracking-[0.25em] text-center uppercase text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
          />
          {checking && (
            <p className="text-xs text-slate-500 mt-1.5 text-center">Checking room code...</p>
          )}
        </div>

        {lookupInfo && (
          <div className="rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="font-display font-bold text-slate-900 dark:text-white">
                {lookupInfo.roomName}
              </div>
              <span className="font-mono-tabular text-xs font-semibold text-slate-500 dark:text-slate-400">
                {lookupInfo.playerCount}/{lookupInfo.maxPlayers} players
              </span>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Mode: {lookupInfo.gameMode.toUpperCase()} · Status: {lookupInfo.status}
            </div>
            {lookupInfo.allowSpectators && (
              <label className="flex items-center gap-2 pt-1 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={asSpectator}
                  onChange={(e) => setAsSpectator(e.target.checked)}
                  className="rounded accent-rose-600"
                />
                Join as Spectator
              </label>
            )}
          </div>
        )}

        {!user && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1.5">
                Guest Username
              </label>
              <input
                type="text"
                required
                minLength={2}
                maxLength={24}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
                Choose Avatar
              </label>
              <div className="grid grid-cols-4 gap-2">
                {AVATAR_OPTIONS.slice(0, 4).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setAvatar(opt.id)}
                    className={`p-2 rounded-xl border flex flex-col items-center gap-1 ${
                      avatar === opt.id
                        ? 'border-rose-500 bg-rose-500/10'
                        : 'border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <PlayerAvatar avatarId={opt.id} username={username} size="sm" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={joining || code.length !== 6}
          className="w-full py-3.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors"
        >
          {joining ? 'Joining Room...' : user ? 'Join Private Room' : 'Enter as Guest & Join'}
        </button>
      </form>
    </div>
  );
}
