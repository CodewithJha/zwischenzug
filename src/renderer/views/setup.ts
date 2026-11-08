import { h, staticView, topbar, zz, type View } from '../dom';

export function setupView(): View {
  const input = h('input', {
    id: 'username',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'username',
    'aria-describedby': 'username-help',
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
      { class: 'screen', 'aria-labelledby': 'setup-title' },
      topbar(),
      h(
        'div',
        { class: 'screen-body' },
        h('h1', { id: 'setup-title', class: 'hero' }, 'Your Lichess account'),
        h(
          'p',
          { id: 'username-help', class: 'lead' },
          'Zwischenzug reads its public game feed to see when a game ends. You sign in to Lichess ' +
            'inside the app; no password or token reaches Zwischenzug.',
        ),
        h(
          'form',
          { class: 'field', onsubmit: (e) => void submit(e) },
          h('label', { for: 'username' }, 'Lichess username'),
          h(
            'div',
            { class: 'input-row' },
            input,
            h('button', { class: 'primary', type: 'submit' }, 'Continue'),
          ),
          error,
        ),
      ),
    ),
  );
}
