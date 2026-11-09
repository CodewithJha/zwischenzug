import type { GameLogEntry } from '../shared/types';

const COLUMNS = [
  'game_id',
  'ended_at',
  'outcome',
  'color',
  'speed',
  'consecutive_losses',
  'baseline_bpm',
  'pulse_at_loss_bpm',
  'time_to_unlock_sec',
  'unlock_reason',
] as const;

// Spreadsheets run text cells starting with these as formulas.
const FORMULA_START = /^[=+\-@\t\r]/;

const cell = (v: string | number | null | undefined): string => {
  let s = v === null || v === undefined ? '' : String(v);
  if (typeof v === 'string' && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The game log as CSV, oldest first. Empty cells mean "not recorded". */
export function logToCsv(games: readonly GameLogEntry[]): string {
  const rows = games.map((g) =>
    [
      g.gameId,
      new Date(g.endedAt).toISOString(),
      g.outcome,
      g.userColor,
      g.speed,
      g.consecutiveLosses,
      g.cooldown?.baselineBpm,
      g.cooldown?.pulseAtLossBpm,
      g.cooldown?.timeToUnlockSec,
      g.cooldown?.unlockReason,
    ]
      .map(cell)
      .join(','),
  );
  return [COLUMNS.join(','), ...rows].join('\n') + '\n';
}
