'use strict';

import { api, setToken, setHouseholdId } from '../api.js';
import { el } from '../util.js';
import { toast } from '../toast.js';

async function renderSetup(root, { onDone }) {
  root.innerHTML = '';
  const card = el('div', { class: 'login-card' }, [
    el('div', { class: 'logo-header' }, [
      el('div', { class: 'logo' }, ['CB']),
      el('div', {}, [
        el('h1', { style: 'font-size:1.3rem' }, ['Bienvenue dans CapBudget']),
        el('p', { class: 'category-subtle' }, ['Créez le compte administrateur pour démarrer.'])
      ])
    ]),
    el('form', { class: 'stack-form', id: 'setup-form' }, [
      el('label', {}, ['Identifiant administrateur']),
      el('input', { name: 'login', required: 'required', autocomplete: 'username' }),
      el('label', {}, ['Mot de passe (8 caractères minimum)']),
      el('input', { name: 'password', type: 'password', required: 'required', minlength: '8', autocomplete: 'new-password' }),
      el('button', { class: 'primary-button', type: 'submit' }, ['Créer le compte administrateur'])
    ])
  ]);
  root.appendChild(el('div', { class: 'login-shell' }, [card]));

  card.querySelector('#setup-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    const login = form.login.value.trim();
    const password = form.password.value;
    try {
      await api.post('/api/setup/admin', { login, password });
      toast('Compte administrateur créé. Connectez-vous.', { type: 'success' });
      onDone();
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  });
}

async function renderLogin(root, { onDone }) {
  root.innerHTML = '';
  const card = el('div', { class: 'login-card' }, [
    el('div', { class: 'logo-header' }, [
      el('div', { class: 'logo' }, ['CB']),
      el('div', {}, [
        el('h1', { style: 'font-size:1.3rem' }, ['CapBudget']),
        el('p', { class: 'category-subtle' }, ['Connectez-vous pour continuer.'])
      ])
    ]),
    el('form', { class: 'stack-form', id: 'login-form' }, [
      el('label', {}, ['Identifiant']),
      el('input', { name: 'login', required: 'required', autocomplete: 'username' }),
      el('label', {}, ['Mot de passe']),
      el('input', { name: 'password', type: 'password', required: 'required', autocomplete: 'current-password' }),
      el('button', { class: 'primary-button', type: 'submit' }, ['Se connecter'])
    ])
  ]);
  root.appendChild(el('div', { class: 'login-shell' }, [card]));

  card.querySelector('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    const login = form.login.value.trim();
    const password = form.password.value;
    const submitBtn = form.querySelector('button');
    submitBtn.disabled = true;
    try {
      const result = await api.post('/api/auth/login', { login, password });
      setToken(result.token);
      setHouseholdId(null);
      onDone(result.user);
    } catch (err) {
      toast(err.message, { type: 'error' });
    } finally {
      submitBtn.disabled = false;
    }
  });
}

export { renderSetup, renderLogin };
