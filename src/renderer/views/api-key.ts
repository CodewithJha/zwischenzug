import { h, zz } from '../dom';

/** Presage API key entry. The key goes to main, which encrypts it with the OS keychain. */
export function apiKeyForm(): { el: HTMLElement; setConfigured(configured: boolean): void } {
  const input = h('input', {
    id: 'presage-key',
    type: 'password',
    placeholder: 'Paste your key',
    autocomplete: 'off',
    'aria-describedby': 'presage-key-help',
  });
  const message = h('p', { class: 'message', role: 'status' });
  const save = async (e: Event): Promise<void> => {
    e.preventDefault();
    const cleared = input.value.trim() === '';
    const res = await zz().setPresageKey(input.value);
    input.value = '';
    if (!res.ok) message.textContent = res.error;
    else
      message.textContent = cleared
        ? 'Saved key removed.'
        : 'Saved, encrypted by your OS keychain.';
  };
  const el = h(
    'form',
    { class: 'field', onsubmit: (e) => void save(e) },
    h('label', { for: 'presage-key' }, 'Presage API key'),
    h('div', { class: 'input-row' }, input, h('button', { type: 'submit' }, 'Save')),
    h(
      'p',
      { id: 'presage-key-help', class: 'field-help' },
      'From physiology.presagetech.com. Save an empty field to remove it.',
    ),
    message,
  );
  return {
    el,
    setConfigured(configured) {
      input.placeholder = configured ? 'Key saved · paste to replace' : 'Paste your key';
    },
  };
}
