import type { AppSnapshot } from '../../shared/types';
import { formatSec, h, zz, type View } from '../dom';

/**
 * Full-window lock screen after a loss. Main owns the decision; this view only shows the
 * numbers and offers the override. `monitor` is the live pulse panel in camera mode.
 */
export function cooldownView(monitor: View | null): View {
  const rule = h('p', { class: 'rule' });
  const progress = h('div', { class: 'progress' });
  const suggestion = h('p', { class: 'suggestion' });
  const sentenceLabel = h('label', { for: 'override' });
  const input = h('input', { id: 'override', autocomplete: 'off', spellcheck: 'false' });
  const error = h('p', { class: 'error', role: 'alert' });

  const submit = async (e: Event): Promise<void> => {
    e.preventDefault();
    const res = await zz().override(input.value);
    if (!res.ok) error.textContent = res.error;
  };

  const el = h(
    'section',
    { class: 'screen cooldown' },
    h('h1', {}, 'Zwischenzug'),
    h('p', { class: 'lead' }, 'That one stung. New games unlock once you have settled.'),
    h(
      'div',
      { class: 'breathe' },
      h('div', { class: 'breathe-circle', 'aria-hidden': 'true' }),
      h('p', {}, 'Breathe in slowly for 4, out for 6.'),
    ),
    monitor?.el,
    rule,
    progress,
    suggestion,
    h(
      'details',
      { class: 'override' },
      h('summary', {}, 'Skip this cooldown'),
      h(
        'form',
        { onsubmit: (e) => void submit(e) },
        sentenceLabel,
        input,
        h('button', { type: 'submit' }, 'Skip and unlock'),
      ),
      error,
    ),
  );

  return {
    el,
    update(s: AppSnapshot) {
      monitor?.update(s);
      const c = s.cooldown;
      if (!c) return;
      sentenceLabel.textContent = `Type: "${s.settings.overrideSentence}"`;
      const wait = c.minWaitRemainingSec;
      const pulsePossible = s.presage.sdkLoaded && s.presage.apiKeyConfigured;
      if (c.baselineBpm === null || !pulsePossible) {
        rule.textContent = `Unlocks by timer in ${formatSec(c.fallbackRemainingSec)}.`;
      } else {
        rule.textContent =
          `Unlocks when your pulse stays at or below ${c.upperBandBpm} bpm for ${c.sustainSec} s` +
          (wait > 0 ? `, and not before ${formatSec(wait)} from now.` : '.');
      }
      const lines: string[] = [];
      if (wait > 0) lines.push(`Minimum pause: ${formatSec(wait)} left`);
      if (c.baselineBpm !== null && pulsePossible) {
        lines.push(
          c.signalFresh
            ? `Settled for ${Math.min(c.settledForSec, c.sustainSec)} / ${c.sustainSec} s`
            : `No pulse reading right now. Timer fallback in ${formatSec(c.fallbackRemainingSec)}`,
        );
      }
      lines.push(`Unlocks at the latest in ${formatSec(c.maxRemainingSec)}`);
      progress.replaceChildren(...lines.map((l) => h('div', {}, l)));

      suggestion.textContent =
        c.suggestedPauseUntil && c.suggestedPauseUntil > Date.now()
          ? `${s.consecutiveLosses} losses in a row. A longer break helps: consider stepping away ` +
            `until ${new Date(c.suggestedPauseUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
          : '';
    },
    destroy: () => monitor?.destroy(),
  };
}
