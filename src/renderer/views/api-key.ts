import { h, zz } from '../dom';

/** Presage API key entry. The key goes to main, which encrypts it with the OS keychain. */
export function apiKeyForm(): HTMLElement {
  const input = h('input', {
    type: 'password',
    placeholder: 'Presage API key',
    autocomplete: 'off',
  });
  const message = h('p', { class: 'muted', role: 'status' });
  const save = async (e: Event): Promise<void> => {
    e.preventDefault();
    const res = await zz().setPresageKey(input.value);
    input.value = '';
    message.textContent = res.ok ? 'Saved (encrypted with your OS keychain).' : res.error;
  };
  return h(
    'form',
    { onsubmit: (e) => void save(e) },
    h('label', {}, 'Presage API key (from physiology.presagetech.com; or set PRESAGE_API_KEY)'),
    input,
    h('button', { type: 'submit' }, 'Save key'),
    message,
  );
}
