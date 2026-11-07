import { h, zz } from '../dom';

/** Presage API key entry. The key goes to main, which encrypts it with the OS keychain. */
export function apiKeyForm(): HTMLElement {
  const input = h('input', {
    id: 'presage-key',
    type: 'password',
    placeholder: 'Paste a key to save it',
    autocomplete: 'off',
    'aria-describedby': 'presage-key-help',
  });
  const message = h('p', { class: 'muted', role: 'status' });
  const save = async (e: Event): Promise<void> => {
    e.preventDefault();
    const cleared = input.value.trim() === '';
    const res = await zz().setPresageKey(input.value);
    input.value = '';
    if (!res.ok) message.textContent = res.error;
    else
      message.textContent = cleared
        ? 'Saved key removed.'
        : 'Saved (encrypted with your OS keychain).';
  };
  return h(
    'form',
    { class: 'key-form', onsubmit: (e) => void save(e) },
    h('label', { for: 'presage-key' }, 'Presage API key'),
    h(
      'p',
      { id: 'presage-key-help', class: 'field-help' },
      'From physiology.presagetech.com, or set PRESAGE_API_KEY. Saving an empty field removes a saved key.',
    ),
    input,
    h('button', { type: 'submit' }, 'Save key'),
    message,
  );
}
