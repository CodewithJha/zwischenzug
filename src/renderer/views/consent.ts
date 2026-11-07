import { h, staticView, zz, type View } from '../dom';

export function consentView(): View {
  const error = h('p', { class: 'error', role: 'alert' });
  const choose = async (mode: 'camera' | 'timer-only'): Promise<void> => {
    const res = await zz().giveConsent(mode);
    if (!res.ok) error.textContent = res.error;
  };

  return staticView(
    h(
      'section',
      { class: 'screen consent' },
      h('h1', {}, 'Zwischenzug'),
      h('p', { class: 'lead' }, 'The in-between move: a pause after a loss, before the next game.'),
      h(
        'p',
        {},
        'After you lose a game on Lichess, Zwischenzug locks new games until you have settled. ' +
          'If you allow the camera, "settled" means your pulse is back near your own resting ' +
          'level. Without the camera, a timer is used instead.',
      ),
      h('h2', {}, 'How the camera is used'),
      h(
        'ul',
        {},
        h(
          'li',
          {},
          'Only between games: during a one-minute check-in and after a loss. Never while you play.',
        ),
        h(
          'li',
          {},
          'Your pulse is estimated on this computer by the Presage SmartSpectra SDK. No video is uploaded or saved.',
        ),
        h(
          'li',
          {},
          'The SDK contacts Presage to check the API key and usage, never with video. SDK telemetry is turned off.',
        ),
        h(
          'li',
          {},
          'Your baseline and game log are stored in a local file. You can delete everything at any time.',
        ),
        h('li', {}, 'You can always skip a cooldown by typing a confirmation sentence.'),
      ),
      h(
        'p',
        { class: 'note' },
        'Zwischenzug is a habit tool, not a medical device. It does not diagnose, treat or monitor any condition.',
      ),
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          { class: 'primary', onclick: () => void choose('camera') },
          'Allow camera between games',
        ),
        h('button', { onclick: () => void choose('timer-only') }, 'Timer only, no camera'),
      ),
      error,
    ),
  );
}
