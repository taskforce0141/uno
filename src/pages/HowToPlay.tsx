import { AppRoute } from '../components/layout/TopNav';

export function HowToPlay({ onNavigate }: { onNavigate: (route: AppRoute) => void }) {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8">
      <div className="space-y-2">
        <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white">
          How to Play UNO ARENA
        </h1>
        <p className="text-base text-slate-600 dark:text-slate-300">
          Everything you need to know about Private Rooms, Classic UNO, UNO Flip, and Custom House Rules.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-3">
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
            01. Classic UNO
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            Each player starts with 7 cards. On your turn, play a card matching the active color, number, or symbol of the top discard card—or play a Wild card to pick the next color.
          </p>
          <ul className="text-xs text-slate-500 dark:text-slate-400 space-y-1.5 list-disc pl-4">
            <li>Skip: Next player loses their turn.</li>
            <li>Reverse: Flips turn direction (acts like Skip in 2-player matches).</li>
            <li>Draw Two (+2): Next player draws 2 cards and is skipped.</li>
            <li>Wild Draw Four (+4): Change color and force next player to draw 4 (or challenge!).</li>
            <li>Call UNO! when you are down to 1 card so opponents cannot catch you.</li>
          </ul>
        </section>

        <section className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-3">
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
            02. UNO Flip (Light & Dark Sides)
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            Every card has two playable sides. Playing a Flip card switches all hands, the draw pile, and the discard pile to the opposite side.
          </p>
          <ul className="text-xs text-slate-500 dark:text-slate-400 space-y-1.5 list-disc pl-4">
            <li>Light Side: Red, Blue, Green, Yellow · Draw One (+1), Wild +2.</li>
            <li>Dark Side: Pink, Teal, Orange, Purple · Draw Five (+5), Skip Everyone, Wild Draw Color.</li>
            <li>Skip Everyone gives you another immediate turn!</li>
            <li>Wild Draw Color forces the next player to draw until they pull a card of the chosen color.</li>
          </ul>
        </section>

        <section className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-3 md:col-span-2">
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
            03. Custom House Rules
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-slate-600 dark:text-slate-300">
            <div>
              <strong className="text-slate-900 dark:text-white">Draw Stacking:</strong> Chain +2 on +2, +4 on +4, or mix them to build massive penalties.
            </div>
            <div>
              <strong className="text-slate-900 dark:text-white">Jump-In:</strong> Play an exact matching color and value card out of turn anytime.
            </div>
            <div>
              <strong className="text-slate-900 dark:text-white">Seven-O Rule:</strong> Playing a 7 swaps your hand with another player; playing a 0 rotates all hands in turn direction.
            </div>
            <div>
              <strong className="text-slate-900 dark:text-white">Multi-Card & Draw Until Playable:</strong> Drop identical cards together or keep drawing until a playable card appears.
            </div>
          </div>
        </section>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => onNavigate('create')}
          className="px-6 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold"
        >
          Create Private Room
        </button>
        <button
          type="button"
          onClick={() => onNavigate('join')}
          className="px-6 py-3 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-semibold"
        >
          Join With Code
        </button>
      </div>
    </div>
  );
}
