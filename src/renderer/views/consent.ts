import { h, staticView, topbar, zz, type View } from '../dom';

const POINTS: [string, string][] = [
  ['When', 'Only between games: a one-minute check-in, and after a loss. Never while you play.'],
  ['Where', 'Your pulse is estimated on this computer. No video is uploaded or saved.'],
  [
    'Network',
    'Presage is contacted to check your API key and usage, never with video. Telemetry is off.',
  ],
  [
    'Your data',
    'Baseline and game log stay on this computer. Delete all erases them, the saved key, logs and your Lichess sign-in in the app.',
  ],
  ['Your call', 'Any cooldown can be skipped by typing a short sentence.'],
];

export function consentView(): View {
  const error = h('p', { class: 'error', role: 'alert' });
  const choose = async (mode: 'camera' | 'timer-only'): Promise<void> => {
    const res = await zz().giveConsent(mode);
    if (!res.ok) error.textContent = res.error;
  };

  return staticView(
    h(
      'section',
      { class: 'screen consent', 'aria-labelledby': 'consent-title' },
      topbar(),
      h(
        'div',
        { class: 'screen-body' },
        h('h1', { id: 'consent-title', class: 'hero' }, 'A pause after a loss.'),
        h(
          'p',
          { class: 'lead' },
          'After you lose on Lichess, new games stay locked until your pulse is back near your ' +
            'resting level. Without the camera, a timer does the same.',
        ),
        h(
          'dl',
          { class: 'facts consent-points', 'aria-label': 'How the camera is used' },
          ...POINTS.flatMap(([term, text]) => [h('dt', {}, term), h('dd', {}, text)]),
        ),
        h(
          'div',
          { class: 'actions' },
          h(
            'button',
            { class: 'primary', onclick: () => void choose('camera') },
            'Allow camera between games',
          ),
          h('button', { onclick: () => void choose('timer-only') }, 'Timer only'),
        ),
        error,
        h('p', { class: 'fine-print' }, 'A habit tool, not a medical device.'),
      ),
    ),
  );
}
