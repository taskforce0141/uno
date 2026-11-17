import { Check, Copy, Link2, QrCode, Share2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { buildInviteUrl } from '../../utils/roomUtils';

export function InvitePanel({
  roomCode,
  roomName,
  onNotify,
}: {
  roomCode: string;
  roomName: string;
  onNotify: (msg: string) => void;
}) {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showQr, setShowQr] = useState(true);
  const inviteUrl = buildInviteUrl(roomCode);

  const copyText = async (text: string, type: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'code') {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
        onNotify('Room code copied to clipboard.');
      } else {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
        onNotify('Invitation link copied to clipboard.');
      }
    } catch {
      onNotify('Copy failed — please select and copy manually.');
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Join ${roomName} on UNO ARENA`,
          text: `Join my private UNO ARENA room with code ${roomCode}`,
          url: inviteUrl,
        });
        return;
      } catch {
        // user cancelled or share unavailable
      }
    }
    await copyText(inviteUrl, 'link');
  };

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            Private Room Invitation
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Invite-only · Share the code, link, or QR code with friends
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowQr((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
        >
          <QrCode className="w-4 h-4" />
          {showQr ? 'Hide QR' : 'Show QR'}
        </button>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="flex-1 px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Room Code</div>
            <div className="font-mono-tabular text-2xl font-bold tracking-[0.2em] text-slate-900 dark:text-white">
              {roomCode}
            </div>
          </div>
          <button
            type="button"
            onClick={() => copyText(roomCode, 'code')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
          >
            {copiedCode ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copiedCode ? 'Copied' : 'Copy Code'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2.5">
        <button
          type="button"
          onClick={() => copyText(inviteUrl, 'link')}
          className="flex-1 min-w-[140px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
        >
          {copiedLink ? <Check className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
          {copiedLink ? 'Link Copied' : 'Copy Invite Link'}
        </button>

        <button
          type="button"
          onClick={handleShare}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
        >
          <Share2 className="w-4 h-4" />
          Share Invitation
        </button>
      </div>

      <div className="text-xs font-mono-tabular text-slate-500 dark:text-slate-400 truncate bg-slate-50 dark:bg-slate-950/60 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800">
        {inviteUrl}
      </div>

      {showQr && (
        <div className="flex items-center gap-4 pt-2">
          <div className="p-3 rounded-xl bg-white border border-slate-200 shrink-0">
            <QRCodeSVG value={inviteUrl} size={108} level="M" />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Friends on phones or tablets can scan this QR code to jump straight into this private lobby.
          </p>
        </div>
      )}
    </div>
  );
}
