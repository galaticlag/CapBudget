'use strict';

import { api } from '../api.js';
import { el } from '../util.js';
import { toast } from '../toast.js';

async function renderAdmin(root) {
  root.innerHTML = '';
  const householdsPanel = el('div', { class: 'panel' });
  const usersPanel = el('div', { class: 'panel' });
  const auditPanel = el('div', { class: 'panel' });
  root.appendChild(el('div', { class: 'dashboard' }, [householdsPanel, usersPanel, auditPanel]));

  let households = [];

  async function loadHouseholds() {
    households = await api.get('/api/households');
    householdsPanel.innerHTML = '';
    householdsPanel.appendChild(el('div', { class: 'panel-header' }, [el('h2', {}, ['Foyers'])]));
    const form = el('form', { class: 'filter-row' }, [
      el('input', { name: 'name', placeholder: 'Nom du foyer', required: 'required' }),
      el('button', { class: 'primary-button', type: 'submit' }, ['Créer un foyer'])
    ]);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.post('/api/households', { name: e.target.name.value.trim() });
        toast('Foyer créé.', { type: 'success' });
        e.target.reset();
        loadHouseholds();
        loadUsers();
      } catch (err) { toast(err.message, { type: 'error' }); }
    });
    householdsPanel.appendChild(form);

    const list = el('div', { class: 'category-list panel-separator' });
    for (const h of households) {
      list.appendChild(el('div', { class: 'category-row' }, [
        el('div', { class: 'category-meta' }, [
          el('span', { class: 'category-name' }, [h.name]),
          !h.is_active ? el('span', { class: 'chip' }, ['Archivé']) : el('span', {})
        ]),
        el('button', {
          class: 'ghost-button',
          onclick: async () => {
            try {
              await api.put(`/api/households/${h.id}`, { isActive: h.is_active ? false : true });
              loadHouseholds();
            } catch (err) { toast(err.message, { type: 'error' }); }
          }
        }, [h.is_active ? 'Archiver' : 'Réactiver'])
      ]));
    }
    householdsPanel.appendChild(list);
  }

  async function loadUsers() {
    const users = await api.get('/api/admin/users');
    usersPanel.innerHTML = '';
    usersPanel.appendChild(el('div', { class: 'panel-header' }, [el('h2', {}, ['Utilisateurs'])]));

    const householdSelect = el('select', { name: 'householdId' }, [
      el('option', { value: '__new__' }, ['Créer un nouveau foyer']),
      ...households.map((h) => el('option', { value: h.id }, [h.name]))
    ]);
    const newHouseholdNameInput = el('input', {
      name: 'newHouseholdName',
      placeholder: 'Nom du nouveau foyer',
      required: 'required'
    });
    householdSelect.addEventListener('change', () => {
      const isNew = householdSelect.value === '__new__';
      newHouseholdNameInput.style.display = isNew ? '' : 'none';
      newHouseholdNameInput.required = isNew;
    });
    const form = el('form', { class: 'filter-row' }, [
      el('input', { name: 'login', placeholder: 'Identifiant', required: 'required' }),
      el('input', { name: 'password', type: 'password', placeholder: 'Mot de passe (8+ caractères)', required: 'required', minlength: '8' }),
      el('select', { name: 'role' }, [el('option', { value: 'MEMBER' }, ['Membre']), el('option', { value: 'ADMIN' }, ['Administrateur'])]),
      householdSelect,
      newHouseholdNameInput,
      el('button', { class: 'primary-button', type: 'submit' }, ['Créer'])
    ]);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const role = e.target.role.value;
      let householdId = householdSelect.value;
      if (role === 'MEMBER' && !householdId) {
        toast('Un membre doit être associé à au moins un foyer : sélectionnez-en un existant ou créez-en un nouveau.', { type: 'error' });
        return;
      }
      try {
        if (role === 'MEMBER' && householdId === '__new__') {
          const newName = newHouseholdNameInput.value.trim();
          if (!newName) {
            toast('Merci de saisir un nom pour le nouveau foyer.', { type: 'error' });
            return;
          }
          const created = await api.post('/api/households', { name: newName });
          householdId = created.id;
          await loadHouseholds();
        }
        await api.post('/api/admin/users', {
          login: e.target.login.value.trim(),
          password: e.target.password.value,
          role,
          householdIds: role === 'MEMBER' ? [householdId] : []
        });
        toast('Utilisateur créé.', { type: 'success' });
        loadUsers();
      } catch (err) { toast(err.message, { type: 'error' }); }
    });
    usersPanel.appendChild(form);

    const list = el('div', { class: 'category-list panel-separator' });
    for (const u of users) {
      list.appendChild(el('div', { class: 'category-row' }, [
        el('div', { class: 'category-meta' }, [
          el('span', { class: 'category-name' }, [u.login]),
          el('span', { class: 'category-subtle' }, [`${u.role}${u.households?.length ? ' · ' + u.households.map((h) => h.name).join(', ') : ''}`])
        ]),
        el('button', {
          class: 'ghost-button',
          onclick: async () => {
            try {
              await api.put(`/api/admin/users/${u.id}`, { isActive: u.is_active ? false : true });
              loadUsers();
            } catch (err) { toast(err.message, { type: 'error' }); }
          }
        }, [u.is_active ? 'Désactiver' : 'Réactiver'])
      ]));
    }
    usersPanel.appendChild(list);
  }

  async function loadAudit() {
    const rows = await api.get('/api/audit/global');
    auditPanel.innerHTML = '';
    auditPanel.appendChild(el('div', { class: 'panel-header' }, [el('h2', {}, ['Journal global'])]));
    const list = el('div', { class: 'transaction-list' });
    for (const r of rows.slice(0, 50)) {
      list.appendChild(el('div', { class: 'transaction-row' }, [
        el('div', { class: 'transaction-main' }, [
          el('span', { class: 'transaction-label' }, [`${r.action} · ${r.entity_type}`]),
          el('span', { class: 'transaction-sub' }, [`${r.user_login || 'système'} · ${new Date(r.created_at).toLocaleString('fr-FR')}`])
        ])
      ]));
    }
    auditPanel.appendChild(list);
  }

  try {
    await loadHouseholds();
    await loadUsers();
    await loadAudit();
  } catch (err) {
    toast(err.message, { type: 'error' });
  }
}

export { renderAdmin };
