import type { AppSnapshot } from '../../shared/types';
import type { ProviderState } from '../biometrics/provider';

/**
 * Which unlock rule the cooldown screen should present as active, and why. Mirrors the
 * engine rule: pulse needs a baseline and a fresh reading; otherwise the timer applies.
 */
export type UnlockPath =
  | { kind: 'pulse' }
  /** Pulse is possible but there is no fresh reading yet; the timer keeps counting meanwhile. */
  | { kind: 'waiting'; detail: string }
  | { kind: 'timer'; reason: string };

export function unlockPath(s: AppSnapshot, provider: ProviderState | null): UnlockPath {
  const c = s.cooldown;
  if (s.profile.consent?.mode !== 'camera') {
    return { kind: 'timer', reason: 'You chose timer only.' };
  }
  if (c?.baselineBpm == null) {
    return { kind: 'timer', reason: 'No baseline yet. Recalibrate to unlock by pulse.' };
  }
  if (!s.presage.sdkLoaded) {
    return { kind: 'timer', reason: s.presage.sdkError ?? 'The Presage SDK is not available.' };
  }
  if (!s.presage.apiKeyConfigured) return { kind: 'timer', reason: 'No Presage API key is set.' };
  if (provider?.kind === 'unavailable') return { kind: 'timer', reason: provider.reason };
  if (c.signalFresh) return { kind: 'pulse' };
  if (provider?.kind === 'measuring') {
    return provider.ok
      ? { kind: 'waiting', detail: 'Hold still, facing the light.' }
      : { kind: 'timer', reason: provider.hint ?? 'No pulse reading right now.' };
  }
  return { kind: 'waiting', detail: 'Starting the camera…' };
}
