import { useContext } from 'react';
import { GameContext } from '../context/GameContext';

export function useRoom() {
  const ctx = useContext(GameContext);
  if (!ctx) {
    throw new Error('useRoom must be used inside GameProvider');
  }
  return {
    room: ctx.room,
    connectionStatus: ctx.connectionStatus,
    attachRoom: ctx.attachRoom,
    clearRoom: ctx.clearRoom,
    reconnectToRoom: ctx.reconnectToRoom,
    updateLobbyPlayer: ctx.updateLobbyPlayer,
    updateSettings: ctx.updateSettings,
    kickPlayer: ctx.kickPlayer,
    leaveCurrentRoom: ctx.leaveCurrentRoom,
    closeCurrentRoom: ctx.closeCurrentRoom,
    startGame: ctx.startGame,
    backToLobby: ctx.backToLobby,
  };
}
