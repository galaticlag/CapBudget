'use strict';

const THEME_KEY = 'capbudget.theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(preference) {
  const body = document.body;
  body.classList.remove('dark', 'high-contrast');
  let effective = preference;
  if (preference === 'SYSTEM') effective = media.matches ? 'DARK' : 'LIGHT';
  if (effective === 'DARK') body.classList.add('dark');
  if (effective === 'HIGH_CONTRAST') body.classList.add('high-contrast');
}

function initTheme() {
  const stored = localStorage.getItem(THEME_KEY) || 'SYSTEM';
  applyTheme(stored);
  media.addEventListener('change', () => {
    const current = localStorage.getItem(THEME_KEY) || 'SYSTEM';
    if (current === 'SYSTEM') applyTheme('SYSTEM');
  });
  return stored;
}

function setTheme(preference) {
  localStorage.setItem(THEME_KEY, preference);
  applyTheme(preference);
}

export { initTheme, setTheme, applyTheme };
