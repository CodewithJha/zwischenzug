import { h, staticView, zz, type View } from '../dom';

export function setupView(): View {
  const input = h('input', {
    id: 'username',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'your Lichess username',
  });
  const error = h('p', { class: 'error', role: 'alert' });
  const submit = async (e: Event): Promise<void> => {
    e.preventDefault();
    const res = await zz().setUsername(input.value);
    if (!res.ok) error.textContent = res.error;
  };

  return staticView(
    h(
      'section',
      { class: 'screen' },
      h('h1', {}, 'Which Lichess account?'),
      h(
        'p',
        {},
        'Zwischenzug watches the public game feed of this account to notice when a game ends. ' +
          'You will still sign in to Lichess normally inside the app; no Lichess password or token is shared with Zwischenzug.',
      ),
      h(
        'form',
        { onsubmit: (e) => void submit(e) },
        h('label', { for: 'username' }, 'Lichess username'),
        input,
        h('button', { class: 'primary', type: 'submit' }, 'Continue'),
      ),
      error,
    ),
  );
}
