'use strict';

import { api, getToken, getHouseholdId } from '../api.js';
import { el, clampBudgetStartDay, resolveBudgetDayOfMonth } from '../util.js';
import { toast } from '../toast.js';
import { setTheme } from '../theme.js';

const THEME_OPTIONS = [
  { value: 'SYSTEM', label: 'Système' },
  { value: 'LIGHT', label: 'Clair' },
  { value: 'DARK', label: 'Sombre' },
  { value: 'HIGH_CONTRAST', label: 'Contraste élevé' }
];

async function renderSettings(root, user) {
  root.innerHTML = '';
  const themePanel = el('div', { class: 'panel' });
  const budgetMonthPanel = el('div', { class: 'panel' });
  const passwordPanel = el('div', { class: 'panel' });
  const sessionsPanel = el('div', { class: 'panel' });
  const backupPanel = el('div', { class: 'panel' });
  root.appendChild(el('div', { class: 'dashboard' }, [themePanel, budgetMonthPanel, passwordPanel, sessionsPanel, backupPanel]));

  themePanel.appendChild(el('div', { class: 'panel-header' }, [el('h2', {}, ['Apparence'])]));
  const themeRow = el('div', { class: 'filter-row' }, THEME_OPTIONS.map((opt) => el('button', {
    class: `chip ${user.themePreference === opt.value ? 'chip-active' : ''}`,
    onclick: async () => {
      try {
        await api.put('/api/me/theme', { themePreference: opt.value });
        setTheme(opt.value);
        user.themePreference = opt.value;
        toast('Thème mis à jour.', { type: 'success' });
        render();
      } catch (err) { toast(err.message, { type: 'error' }); }
    }
  }, [opt.label])));
  themePanel.appendChild(themeRow);

  budgetMonthPanel.appendChild(el('div', { class: 'panel-header' }, [el('h2', {}, ['Mois budgétaire'])]));
  budgetMonthPanel.appendChild(el('p', { class: 'field-hint' }, [
    'Jour à partir duquel démarre votre période budgétaire. Par défaut (1), le mois ' +
    'budgétaire correspond au mois civil. Si votre salaire est versé en fin de mois, le ' +
    'compter dès le 1er du mois suivant comme "nouveau mois" est trompeur : vous vivez en ' +
    'réalité sur ce salaire jusqu\u2019au mois suivant. Choisissez un jour positif pour un ' +
    'jour fixe du mois (ex. "25" pour un salaire toujours versé le 25), ou un jour négatif ' +
    'compté depuis la fin du mois (ex. "-1" pour le dernier jour du mois, quel que soit le ' +
    'nombre de jours qu\u2019il compte — 28, 29, 30 ou 31).'
  ]));
  let budgetStartDay = 1;
  try {
    const settings = await api.get('/api/household/settings');
    budgetStartDay = clampBudgetStartDay(settings?.budgetStartDay);
  } catch (err) { toast(err.message, { type: 'error' }); }

  // Negative options read "-1 (dernier jour du mois précédent)" etc. — ordinal-from-end
  // phrasing since "-1" alone doesn't obviously mean "last day" to most users.
  const negativeDayLabel = (n) => {
    if (n === 1) return 'dernier jour du mois précédent';
    if (n === 2) return 'avant-dernier jour du mois précédent';
    return `${n}e jour avant la fin du mois précédent`;
  };
  const positiveOptions = Array.from({ length: 28 }, (_, i) => i + 1).map((day) => el('option', {
    value: String(day),
    selected: day === budgetStartDay ? 'selected' : undefined
  }, [`${day} (${day === 1 ? '1er' : `${day}e`} du mois)`]));
  const negativeOptions = Array.from({ length: 15 }, (_, i) => -(i + 1)).map((day) => el('option', {
    value: String(day),
    selected: day === budgetStartDay ? 'selected' : undefined
  }, [`${day} (${negativeDayLabel(-day)})`]));
  const budgetDaySelect = el('select', {}, [
    el('optgroup', { label: 'Compté depuis la fin du mois précédent' }, negativeOptions),
    el('optgroup', { label: 'Jour fixe du mois' }, positiveOptions)
  ]);

  // Concrete live example (uses the current calendar month) so the abstract day
  // encoding — especially the negative, month-length-dependent one — is never
  // left for the user to compute in their head.
  const budgetDayExample = el('p', { class: 'field-hint' });
  const updateBudgetDayExample = () => {
    const day = clampBudgetStartDay(budgetDaySelect.value);
    const today = new Date();
    const resolvedDay = resolveBudgetDayOfMonth(today.getFullYear(), today.getMonth(), day);
    const exampleDate = new Date(today.getFullYear(), today.getMonth(), resolvedDay);
    const label = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(exampleDate);
    budgetDayExample.textContent = day > 0
      ? `Pour le mois en cours, votre mois budgétaire démarre le ${label}.`
      : `Pour le mois en cours, votre mois budgétaire démarre le ${label} (s\u2019adapte automatiquement aux mois plus courts ou plus longs).`;
  };
  budgetDaySelect.addEventListener('change', updateBudgetDayExample);
  updateBudgetDayExample();

  const budgetMonthForm = el('form', { class: 'stack-form' }, [
    el('label', { class: 'field-mini-label' }, ['Jour de début du mois budgétaire']),
    budgetDaySelect,
    budgetDayExample,
    el('button', { class: 'primary-button', type: 'submit' }, ['Enregistrer'])
  ]);
  budgetMonthForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { budgetStartDay: saved } = await api.put('/api/household/settings', { budgetStartDay: Number(budgetDaySelect.value) });
      budgetStartDay = saved;
      toast('Mois budgétaire mis à jour.', { type: 'success' });
    } catch (err) { toast(err.message, { type: 'error' }); }
  });
  budgetMonthPanel.appendChild(budgetMonthForm);

  passwordPanel.appendChild(el('div', { class: 'panel-header' }, [el('h2', {}, ['Changer le mot de passe'])]));
  const pwForm = el('form', { class: 'stack-form' }, [
    el('input', { type: 'password', name: 'currentPassword', placeholder: 'Mot de passe actuel', required: 'required', autocomplete: 'current-password' }),
    el('input', { type: 'password', name: 'newPassword', placeholder: 'Nouveau mot de passe (8 caractères min.)', required: 'required', minlength: '8', autocomplete: 'new-password' }),
    el('button', { class: 'primary-button', type: 'submit' }, ['Mettre à jour'])
  ]);
  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.put('/api/me/password', { currentPassword: e.target.currentPassword.value, newPassword: e.target.newPassword.value });
      toast('Mot de passe mis à jour. Vos autres sessions ont été déconnectées.', { type: 'success' });
      e.target.reset();
    } catch (err) { toast(err.message, { type: 'error' }); }
  });
  passwordPanel.appendChild(pwForm);

  sessionsPanel.appendChild(el('div', { class: 'panel-header' }, [el('h2', {}, ['Sessions'])]));
  sessionsPanel.appendChild(el('button', {
    class: 'ghost-button',
    onclick: async () => {
      try {
        await api.post('/api/me/sessions/revoke-others', {});
        toast('Autres sessions déconnectées.', { type: 'success' });
      } catch (err) { toast(err.message, { type: 'error' }); }
    }
  }, ['Déconnecter les autres appareils']));

  backupPanel.appendChild(el('div', { class: 'panel-header' }, [el('h2', {}, ['Sauvegarde & restauration'])]));
  backupPanel.appendChild(el('p', { class: 'field-hint' }, [
    'Téléchargez une copie complète de la base de données de votre foyer, ou restaurez-la depuis un fichier précédemment téléchargé (utile pour migrer vers un autre serveur, par exemple un Raspberry Pi).'
  ]));

  const downloadButton = el('button', {
    class: 'ghost-button',
    onclick: async () => {
      try {
        const res = await api.get('/api/household/backup', { rawResponse: true });
        const blob = await res.blob();
        const disposition = res.headers.get('Content-Disposition') || '';
        const match = /filename="([^"]+)"/.exec(disposition);
        const filename = match ? match[1] : 'lyrava-backup.sqlite';
        const url = URL.createObjectURL(blob);
        const link = el('a', { href: url, download: filename });
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        toast('Sauvegarde téléchargée.', { type: 'success' });
      } catch (err) { toast(err.message, { type: 'error' }); }
    }
  }, ['Télécharger une sauvegarde']);

  const restoreInput = el('input', { type: 'file', accept: '.sqlite' });
  const restoreButton = el('button', {
    class: 'ghost-button chip-warning',
    onclick: async () => {
      const file = restoreInput.files[0];
      if (!file) {
        toast('Sélectionnez un fichier de sauvegarde (.sqlite) d\u2019abord.', { type: 'error' });
        return;
      }
      if (!confirm('Ceci va REMPLACER toutes les données actuelles du foyer par le contenu de ce fichier. Cette action est irréversible. Continuer ?')) {
        return;
      }
      try {
        const buffer = await file.arrayBuffer();
        const headers = { 'Content-Type': 'application/octet-stream' };
        const token = getToken();
        if (token) headers.Authorization = `Bearer ${token}`;
        const householdId = getHouseholdId();
        if (householdId) headers['x-household-id'] = householdId;
        const res = await fetch('/api/household/restore', { method: 'POST', headers, body: buffer });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error((data && data.error) || `Erreur ${res.status}`);
        toast('Restauration terminée. Rechargement…', { type: 'success' });
        setTimeout(() => window.location.reload(), 1000);
      } catch (err) { toast(err.message, { type: 'error' }); }
    }
  }, ['Restaurer depuis une sauvegarde']);

  backupPanel.appendChild(el('div', { class: 'stack-form' }, [downloadButton, restoreInput, restoreButton]));

  function render() {
    for (const chip of themeRow.children) {
      chip.classList.toggle('chip-active', chip.textContent === THEME_OPTIONS.find((o) => o.value === user.themePreference)?.label);
    }
  }
}

export { renderSettings };
