import { useState } from 'react';
import {
  CheckCircle2,
  Crown,
  LogOut,
  Play,
  Settings2,
  Trash2,
  UserX,
} from 'lucide-react';
import { AVATAR_OPTIONS, GameMode } from '../engine/gameTypes';
import { summarizeActiveRules, resolveRulesForMode } from '../engine/customRules';
import { useAuth } from '../hooks/useAuth';
import { useGame } from '../hooks/useGame';
import { PlayerAvatar } from '../components/ui/PlayerAvatar';
import { InvitePanel } from '../components/lobby/InvitePanel';
import { CustomRulesEditor } from '../components/room/CustomRulesEditor';
import { ConfirmModal } from '../components/ui/ConfirmModal';

export function Lobby({ onLeft }: { onLeft: () => void }) {
  const { user, updateProfile } = useAuth();
  const {
    room,
    connectionStatus,
    addToast,
    updateLobbyPlayer,
    updateSettings,
    kickPlayer,
    leaveCurrentRoom,
    closeCurrentRoom,
    startGame,
  } = useGame();

  const [editingSettings, setEditingSettings] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [starting, setStarting] = useState(false);
  const [editName, setEditName] = useState(user?.username || '');
  const [editingProfile, setEditingProfile] = useState(false);

  if (!room || !user) return null;

  const isHost = room.hostId === user.uid;
  const hostPlayer = room.players.find((p) => p.isHost || p.id === room.hostId);
  const me = room.players.find((p) => p.id === user.uid);
  const activePlayers = room.players.filter((p) => !p.isSpectator);
  const emptySlots = Math.max(0, room.maxPlayers - activePlayers.length);
  const ruleLines = summarizeActiveRules(room.gameMode, room.customRules);

  const handleToggleReady = async () => {
    if (!me) return;
    try {
      await updateLobbyPlayer({ isReady: !me.isReady });
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Unable to update ready status.', 'error');
    }
  };

  const handleSaveProfile = async () => {
    if (editName.trim().length < 2) {
      addToast('Username must be at least 2 characters.', 'error');
      return;
    }
    try {
      await updateProfile(editName.trim(), me?.avatar || user.avatar);
      await updateLobbyPlayer({ username: editName.trim() });
      setEditingProfile(false);
      addToast('Username updated.', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to update username.', 'error');
    }
  };

  const handleAvatarSelect = async (avatarId: string) => {
    try {
      await updateProfile(me?.username || user.username, avatarId);
      await updateLobbyPlayer({ avatar: avatarId });
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to update avatar.', 'error');
    }
  };

  const handleStartGame = async () => {
    setStarting(true);
    try {
      await startGame();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to start game.', 'error');
    } finally {
      setStarting(false);
    }
  };

  const handleLeave = async () => {
    setConfirmLeave(false);
    await leaveCurrentRoom();
    onLeft();
  };

  const handleCloseRoom = async () => {
    setConfirmClose(false);
    await closeCurrentRoom();
    onLeft();
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      {/* Header Bar */}
      <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>Private Lobby</span>
            <span aria-hidden="true">·</span>
            <span>Host: {hostPlayer?.username || user.username}</span>
            <span aria-hidden="true">·</span>
            <span>{room.gameMode === 'flip' ? 'UNO Flip' : room.gameMode === 'custom' ? 'Custom UNO' : 'Classic UNO'}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular">
              {activePlayers.length}/{room.maxPlayers} Players
            </span>
            <span aria-hidden="true">·</span>
            <span>{connectionStatus === 'connected' ? 'Live Synced' : 'Connecting...'}</span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
            {room.roomName}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {isHost && (
            <>
              <button
                type="button"
                onClick={() => setEditingSettings((v) => !v)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                <Settings2 className="w-4 h-4" />
                {editingSettings ? 'Close Settings' : 'Room Settings'}
              </button>
              <button
                type="button"
                disabled={starting || activePlayers.length < 2}
                onClick={handleStartGame}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                <Play className="w-4 h-4" />
                {starting
                  ? 'Dealing...'
                  : activePlayers.length < 2
                  ? 'Need 2+ Players'
                  : 'Start Game'}
              </button>
            </>
          )}

          {!isHost && me && (
            <button
              type="button"
              onClick={handleToggleReady}
              className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap shrink-0 ${
                me.isReady
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              {me.isReady ? 'Ready' : 'Mark Ready'}
            </button>
          )}

          <button
            type="button"
            onClick={() => setConfirmLeave(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            <LogOut className="w-4 h-4" />
            Leave
          </button>
        </div>
      </div>

      {/* Host Editable Settings Panel */}
      {isHost && editingSettings && (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              Host Room Settings
            </h2>
            <button
              type="button"
              onClick={() => setConfirmClose(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 text-xs font-semibold"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Close Room
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">Game Mode</label>
              <div className="flex gap-1.5">
                {(['classic', 'flip', 'custom'] as GameMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() =>
                      updateSettings({
                        gameMode: mode,
                        customRules: resolveRulesForMode(mode, room.customRules),
                      })
                    }
                    className={`flex-1 py-2 rounded-xl text-xs font-semibold capitalize ${
                      room.gameMode === mode
                        ? 'bg-rose-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                Max Players ({room.maxPlayers})
              </label>
              <input
                type="range"
                min={Math.max(2, activePlayers.length)}
                max={10}
                value={room.maxPlayers}
                onChange={(e) => updateSettings({ maxPlayers: Number(e.target.value) })}
                className="w-full accent-rose-600 mt-2"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">Room Name</label>
              <input
                type="text"
                defaultValue={room.roomName}
                maxLength={40}
                onBlur={(e) => {
                  const val = e.target.value.trim();
                  if (val.length >= 2 && val !== room.roomName) {
                    updateSettings({ roomName: val });
                  }
                }}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
              />
            </div>
          </div>

          <CustomRulesEditor
            gameMode={room.gameMode}
            rules={room.customRules}
            onChange={(next) => updateSettings({ customRules: next })}
          />
        </div>
      )}

      {/* Main Grid: Players Left, Invite & Active Rules Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Players Roster */}
        <div className="lg:col-span-7 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              Players ({activePlayers.length}/{room.maxPlayers})
            </h2>
            <button
              type="button"
              onClick={() => {
                setEditName(me?.username || user.username);
                setEditingProfile((v) => !v);
              }}
              className="text-xs font-semibold text-rose-500 hover:underline"
            >
              {editingProfile ? 'Cancel Edit' : 'Edit My Name & Avatar'}
            </button>
          </div>

          {editingProfile && (
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={editName}
                  maxLength={24}
                  onChange={(e) => setEditName(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                />
                <button
                  type="button"
                  onClick={handleSaveProfile}
                  className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold"
                >
                  Save
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {AVATAR_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleAvatarSelect(opt.id)}
                    className={`p-1 rounded-xl border ${
                      (me?.avatar || user.avatar) === opt.id
                        ? 'border-rose-500'
                        : 'border-transparent'
                    }`}
                  >
                    <PlayerAvatar avatarId={opt.id} username={editName || opt.label} size="sm" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {room.players.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <PlayerAvatar avatarId={p.avatar} username={p.username} size="md" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                        {p.username}
                      </span>
                      {p.isHost && (
                        <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-label="Host" />
                      )}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {p.isHost
                        ? 'Host'
                        : p.isSpectator
                        ? 'Spectator'
                        : p.isReady
                        ? 'Ready'
                        : 'Not Ready'}
                      <span aria-hidden="true"> · </span>
                      <span>{p.connectionStatus === 'online' ? 'Online' : p.connectionStatus}</span>
                    </div>
                  </div>
                </div>

                {isHost && p.id !== user.uid && (
                  <button
                    type="button"
                    onClick={() => kickPlayer(p.id)}
                    title="Remove player"
                    className="p-2 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors shrink-0"
                  >
                    <UserX className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}

            {Array.from({ length: emptySlots }).map((_, idx) => (
              <div
                key={`empty_${idx}`}
                className="flex items-center justify-center p-4 rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 text-xs text-slate-400 dark:text-slate-600"
              >
                Open Seat
              </div>
            ))}
          </div>
        </div>

        {/* Invite & Active Rules */}
        <div className="lg:col-span-5 space-y-6">
          <InvitePanel
            roomCode={room.roomCode}
            roomName={room.roomName}
            onNotify={(msg) => addToast(msg, 'success')}
          />

          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Active Match Rules
            </h3>
            <div className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {ruleLines.join(' · ')}
            </div>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={confirmLeave}
        title="Leave Private Room?"
        message={
          isHost
            ? 'If you leave, host control will transfer to the next player in the room.'
            : 'You will leave this lobby and free up your seat.'
        }
        confirmLabel="Leave Room"
        destructive
        onConfirm={handleLeave}
        onCancel={() => setConfirmLeave(false)}
      />

      <ConfirmModal
        open={confirmClose}
        title="Close Room for Everyone?"
        message="Closing the room disconnects all joined players and invalidates this room code."
        confirmLabel="Close Room"
        destructive
        onConfirm={handleCloseRoom}
        onCancel={() => setConfirmClose(false)}
      />
    </div>
  );
}
