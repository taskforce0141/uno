import { CustomRulesConfig, GameMode } from '../../engine/gameTypes';

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <label
      className={`flex items-start justify-between gap-4 py-3 border-b border-slate-200 dark:border-slate-800/80 last:border-b-0 ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      }`}
    >
      <div className="space-y-0.5">
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-rose-600' : 'bg-slate-300 dark:bg-slate-700'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ${
            checked ? 'translate-x-5.5 ml-0.5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  );
}

export function CustomRulesEditor({
  gameMode,
  rules,
  onChange,
  readOnly = false,
}: {
  gameMode: GameMode;
  rules: CustomRulesConfig;
  onChange: (next: CustomRulesConfig) => void;
  readOnly?: boolean;
}) {
  const update = <K extends keyof CustomRulesConfig>(key: K, value: CustomRulesConfig[K]) => {
    const next = { ...rules, [key]: value };
    if (key === 'sevenORule' || key === 'zeroSevenRule') {
      const enabled = Boolean(value);
      next.sevenORule = enabled;
      next.zeroSevenRule = enabled;
    }
    if (key === 'scoreBasedGame') {
      next.firstPlayerToWin = !Boolean(value);
    }
    if (key === 'firstPlayerToWin') {
      next.scoreBasedGame = !Boolean(value);
    }
    onChange(next);
  };

  return (
    <div className="space-y-6">
      {/* Core Match Timing & Hand Size */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
            Starting Hand Size
          </label>
          <div className="flex flex-wrap gap-2">
            {([5, 6, 7, 8, 10] as const).map((size) => (
              <button
                key={size}
                type="button"
                disabled={readOnly || gameMode !== 'custom'}
                onClick={() => update('startingHandSize', size)}
                className={`px-3.5 py-2 rounded-xl text-sm font-semibold font-mono-tabular transition-colors ${
                  rules.startingHandSize === size
                    ? 'bg-rose-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                } ${readOnly || gameMode !== 'custom' ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                {size}
              </button>
            ))}
          </div>
          {gameMode !== 'custom' && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
              Standard {gameMode === 'flip' ? 'UNO Flip' : 'Classic UNO'} uses 7 cards. Switch to Custom UNO to edit.
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
            Turn Timer
          </label>
          <div className="flex flex-wrap gap-2">
            {([15, 30, 45, 60, 0] as const).map((sec) => (
              <button
                key={sec}
                type="button"
                disabled={readOnly}
                onClick={() => update('turnTimerSeconds', sec)}
                className={`px-3 py-2 rounded-xl text-sm font-semibold font-mono-tabular transition-colors ${
                  rules.turnTimerSeconds === sec
                    ? 'bg-rose-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                } ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                {sec === 0 ? 'Unlimited' : `${sec}s`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Room Access Options */}
      <div className="rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 px-4">
        <ToggleRow
          label="Allow Spectators"
          description="Let invited friends watch the match without joining the hand rotation (off by default)."
          checked={rules.allowSpectators}
          disabled={readOnly}
          onChange={(v) => update('allowSpectators', v)}
        />
        <ToggleRow
          label="Allow Late Joining"
          description="Allow invited friends to join with a fresh hand even after the match has begun."
          checked={rules.allowLateJoining}
          disabled={readOnly}
          onChange={(v) => update('allowLateJoining', v)}
        />
      </div>

      {/* Custom Mode House Rules */}
      {gameMode === 'custom' && (
        <div className="space-y-4">
          <h4 className="text-sm font-bold text-slate-900 dark:text-white">
            Custom House Rules
          </h4>
          <div className="rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 px-4">
            <ToggleRow
              label="Stack Draw Two (+2)"
              description="Players can stack another +2 on an incoming +2 to pass the penalty."
              checked={rules.stackDrawTwo}
              disabled={readOnly}
              onChange={(v) => update('stackDrawTwo', v)}
            />
            <ToggleRow
              label="Stack Draw Four (+4)"
              description="Players can stack another Wild +4 onto an incoming Wild +4."
              checked={rules.stackDrawFour}
              disabled={readOnly}
              onChange={(v) => update('stackDrawFour', v)}
            />
            <ToggleRow
              label="Stack +2 and +4 Together"
              description="Allow Wild +4 on +2 and +2 on Wild +4 in the same draw chain."
              checked={rules.stackDrawTwoAndFour}
              disabled={readOnly}
              onChange={(v) => update('stackDrawTwoAndFour', v)}
            />
            <ToggleRow
              label="Draw Until Playable"
              description="When unable to play, draw cards automatically until a playable card is found."
              checked={rules.drawUntilPlayable}
              disabled={readOnly}
              onChange={(v) => update('drawUntilPlayable', v)}
            />
            <ToggleRow
              label="Force Play After Drawing"
              description="Immediately play a drawn playable card instead of holding it."
              checked={rules.forcePlayAfterDraw}
              disabled={readOnly}
              onChange={(v) => update('forcePlayAfterDraw', v)}
            />
            <ToggleRow
              label="Jump-In"
              description="Play an exact matching color and value card out of turn at any moment."
              checked={rules.jumpIn}
              disabled={readOnly}
              onChange={(v) => update('jumpIn', v)}
            />
            <ToggleRow
              label="Multiple Identical Cards"
              description="Select and play two or more identical cards together in one turn."
              checked={rules.allowMultipleIdentical}
              disabled={readOnly}
              onChange={(v) => update('allowMultipleIdentical', v)}
            />
            <ToggleRow
              label="Seven-O / Zero-Seven Rule"
              description="Playing a 7 swaps hands with a chosen player; playing a 0 rotates all hands."
              checked={rules.sevenORule || rules.zeroSevenRule}
              disabled={readOnly}
              onChange={(v) => update('sevenORule', v)}
            />
            <ToggleRow
              label="Challenge Wild Draw Four"
              description="Next player can challenge a Wild +4 if they suspect the player held the active color."
              checked={rules.challengeWild4}
              disabled={readOnly}
              onChange={(v) => update('challengeWild4', v)}
            />
            <ToggleRow
              label="Score-Based Multi-Round Match"
              description="Play rounds and accumulate points from opponents' leftover cards up to a target score."
              checked={rules.scoreBasedGame}
              disabled={readOnly}
              onChange={(v) => update('scoreBasedGame', v)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
                Forgot UNO Penalty
              </label>
              <div className="flex gap-2">
                {([2, 4] as const).map((cnt) => (
                  <button
                    key={cnt}
                    type="button"
                    disabled={readOnly}
                    onClick={() => update('unoPenaltyCount', cnt)}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold font-mono-tabular transition-colors ${
                      rules.unoPenaltyCount === cnt
                        ? 'bg-rose-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    +{cnt} Cards
                  </button>
                ))}
              </div>
            </div>

            {rules.scoreBasedGame && (
              <div>
                <label className="block text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
                  Target Win Score
                </label>
                <div className="flex gap-2">
                  {([200, 300, 500] as const).map((pts) => (
                    <button
                      key={pts}
                      type="button"
                      disabled={readOnly}
                      onClick={() => update('targetScore', pts)}
                      className={`px-4 py-2 rounded-xl text-sm font-semibold font-mono-tabular transition-colors ${
                        rules.targetScore === pts
                          ? 'bg-rose-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {pts}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
