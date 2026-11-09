import { describe, expect, it } from 'vitest';
import { logToCsv } from '../src/core/export';
import type { GameLogEntry } from '../src/shared/types';

const loss: GameLogEntry = {
  gameId: 'abcd1234',
  endedAt: Date.UTC(2026, 10, 7, 12, 0, 0),
  outcome: 'loss',
  userColor: 'black',
  speed: 'blitz',
  consecutiveLosses: 2,
  cooldown: { baselineBpm: 68, pulseAtLossBpm: 84, timeToUnlockSec: 95, unlockReason: 'biometric' },
};

describe('logToCsv', () => {
  it('writes a header and one row per game, with empty cells for missing values', () => {
    const win: GameLogEntry = {
      ...loss,
      gameId: 'w1',
      outcome: 'win',
      speed: null,
      cooldown: null,
    };
    delete win.consecutiveLosses; // entries logged before this field existed
    expect(logToCsv([loss, win]).split('\n')).toEqual([
      'game_id,ended_at,outcome,color,speed,consecutive_losses,baseline_bpm,pulse_at_loss_bpm,time_to_unlock_sec,unlock_reason',
      'abcd1234,2026-11-07T12:00:00.000Z,loss,black,blitz,2,68,84,95,biometric',
      'w1,2026-11-07T12:00:00.000Z,win,black,,,,,,',
      '',
    ]);
  });

  it('quotes cells that contain separators', () => {
    expect(logToCsv([{ ...loss, speed: 'a,"b"' }])).toContain(',"a,""b""",');
  });

  it('neutralises text cells a spreadsheet would run as formulas', () => {
    for (const evil of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx']) {
      const row = logToCsv([{ ...loss, gameId: evil }]).split('\n')[1];
      expect(row?.startsWith(`'${evil}`)).toBe(true);
    }
    expect(logToCsv([{ ...loss, gameId: '\rx' }])).toContain(`"'\rx"`);
  });
});
