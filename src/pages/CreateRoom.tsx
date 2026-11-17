import React, { useRef, useState } from 'react';
import { Loader2, Lock } from 'lucide-react';
import {
  CustomRulesConfig,
  DEFAULT_CUSTOM_RULES,
  GameMode,
} from '../engine/gameTypes';
import { resolveRulesForMode } from '../engine/customRules';
import { createPrivateRoom } from '../services/roomService';
import { useAuth } from '../hooks/useAuth';
import { useGame } from '../hooks/useGame';
import { CustomRulesEditor } from '../components/room/CustomRulesEditor';

export function CreateRoom({
  onRoomCreated,
  onNeedAuth,
}: {
  onRoomCreated: (roomId: string) => void;
  onNeedAuth: () => void;
}) {
  const { user, signInGuest } = useAuth();
  const { attachRoom, addToast } = useGame();

  const [roomName, setRoomName] = useState('Friday Night UNO');
  const [maxPlayers, setMaxPlayers] = useState(10);
  const [gameMode, setGameMode] = useState<GameMode>('classic');
  const [rules, setRules] = useState<CustomRulesConfig>(DEFAULT_CUSTOM_RULES);
  const [guestName, setGuestName] = useState('Host');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const submittingRef = useRef(false);

  const handleModeSelect = (mode: GameMode) => {
    setGameMode(mode);
    setRules(resolveRulesForMode(mode, rules));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current || creating) {
      return;
    }

    const trimmedRoomName = roomName.trim();
    if (trimmedRoomName.length < 2) {
      setError('Room name must be at least 2 characters.');
      return;
    }

    submittingRef.current = true;
    setError('');
    setCreating(true);
    try {
      let activeUser = user;
      if (!activeUser) {
        if (guestName.trim().length < 2) {
          onNeedAuth();
          return;
        }
        activeUser = await signInGuest(guestName.trim(), 'crimson');
      }

      if (!activeUser || !activeUser.uid) {
        throw new Error('Authentication required to create a private room.');
      }

      const result = await createPrivateRoom(activeUser.sessionToken, {
        roomName: trimmedRoomName,
        gameMode,
        maxPlayers,
        customRules: resolveRulesForMode(gameMode, rules),
        username: activeUser.username,
        avatar: activeUser.avatar,
      });

      if (
        !result ||
        result.success !== true ||
        !result.roomId ||
        !result.roomCode ||
        !result.room
      ) {
        throw new Error('Room creation returned an incomplete response. Please try again.');
      }

      attachRoom(result.room, null, []);
      addToast(`Private room ${result.roomCode} created.`, 'success');
      onRoomCreated(result.roomId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room.');
    } finally {
      submittingRef.current = false;
      setCreating(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 sm:py-10">
      <form
        onSubmit={handleSubmit}
        className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 sm:p-8 space-y-8 shadow-xl"
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-6">
          <div className="space-y-1">
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
              Create Private Room
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Configure your private table, select a mode, and invite friends with a room code.
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-500">
            <Lock className="w-4 h-4" />
            Private Room Only
          </div>
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-sm text-rose-500">
            {error}
          </div>
        )}

        {!user && (
          <div>
            <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1.5">
              Your Host Username (Guest)
            </label>
            <input
              type="text"
              required
              minLength={2}
              maxLength={24}
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white"
            />
          </div>
        )}

        {/* Room Name & Max Players */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1.5">
              Room Name
            </label>
            <input
              type="text"
              required
              minLength={2}
              maxLength={40}
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="Friday Night UNO"
              className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1.5">
              Maximum Players ({maxPlayers})
            </label>
            <input
              type="range"
              min={2}
              max={10}
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(Number(e.target.value))}
              className="w-full accent-rose-600 mt-2.5"
            />
            <div className="flex justify-between text-xs font-mono-tabular text-slate-500 mt-1">
              <span>2</span>
              <span>6</span>
              <span>10 (Default)</span>
            </div>
          </div>
        </div>

        {/* Game Mode Selector */}
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100">
            Select Game Mode
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(
              [
                {
                  id: 'classic',
                  title: 'Classic UNO',
                  desc: 'Traditional 108-card rules with +4 challenges',
                },
                {
                  id: 'flip',
                  title: 'UNO Flip',
                  desc: 'Two-sided Light & Dark decks with Flip cards',
                },
                {
                  id: 'custom',
                  title: 'Custom UNO',
                  desc: 'Stacking, Jump-In, Seven-O & custom scoring',
                },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => handleModeSelect(m.id)}
                className={`p-4 rounded-2xl border text-left transition-all ${
                  gameMode === m.id
                    ? 'border-rose-500 bg-rose-500/10'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-400'
                }`}
              >
                <div className="font-display font-bold text-slate-900 dark:text-white">
                  {m.title}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                  {m.desc}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Rules Configuration */}
        <CustomRulesEditor gameMode={gameMode} rules={rules} onChange={setRules} />

        <div className="pt-2 flex justify-end">
          <button
            type="submit"
            disabled={creating}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white font-semibold text-sm transition-colors"
          >
            {creating && <Loader2 className="w-4 h-4 animate-spin" />}
            {creating ? 'Creating Private Room...' : 'Create Private Room'}
          </button>
        </div>
      </form>
    </div>
  );
}
