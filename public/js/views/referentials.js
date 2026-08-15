'use strict';

import { api } from '../api.js';
import { el } from '../util.js';
import { toast } from '../toast.js';

// Curated icon set for categories/subcategories (stored as a plain emoji string in `icon`).
const ICON_CHOICES = [
  { emoji: '🏠', label: 'Logement' }, { emoji: '💡', label: 'Énergie' },
  { emoji: '🚗', label: 'Auto / Moto' }, { emoji: '⛽', label: 'Carburant' },
  { emoji: '🚌', label: 'Transport en commun' }, { emoji: '🅿️', label: 'Parking' },
  { emoji: '🍽️', label: 'Restaurant' }, { emoji: '🛒', label: 'Courses' },
  { emoji: '☕', label: 'Café / Bar' }, { emoji: '🏥', label: 'Santé' },
  { emoji: '💊', label: 'Pharmacie' }, { emoji: '🎓', label: 'Éducation' },
  { emoji: '🎉', label: 'Loisirs' }, { emoji: '✈️', label: 'Voyage' },
  { emoji: '👕', label: 'Habillement' }, { emoji: '📱', label: 'Télécom' },
  { emoji: '🐾', label: 'Animaux' }, { emoji: '👶', label: 'Enfants' },
  { emoji: '🎁', label: 'Cadeaux' }, { emoji: '🔧', label: 'Entretien' },
  { emoji: '📄', label: 'Assurance' }, { emoji: '🏦', label: 'Banque / Frais' },
  { emoji: '💰', label: 'Épargne' }, { emoji: '📈', label: 'Investissement' },
  { emoji: '💵', label: 'Salaire' }, { emoji: '🔁', label: 'Virement' },
  { emoji: '❓', label: 'Non affectée' }, { emoji: '⭐', label: 'Autre' }
];

function iconSelect(name, selected) {
  return el('select', { name }, [
    el('option', { value: '' }, ['Icône…']),
    ...ICON_CHOICES.map((i) => el('option', { value: i.emoji, selected: selected === i.emoji ? 'selected' : undefined }, [`${i.emoji} ${i.label}`]))
  ]);
}

function budgetTypeSelect(name, budgetTypes, selected) {
  return el('select', { name }, [
    el('option', { value: '' }, ['Type de budget…']),
    ...budgetTypes.map((b) => el('option', { value: b.id, selected: selected === b.id ? 'selected' : undefined }, [b.name]))
  ]);
}

// Wraps an inline row select with a small persistent label so its purpose stays clear once a value is chosen.
function labeledField(label, field) {
  return el('div', { class: 'field-mini' }, [el('span', { class: 'field-mini-label' }, [label]), field]);
}

// Checkbox + label used to flag a category as excluded from the dashboard (e.g. account-to-account transfers).
function excludeFromDashboardField(name, checked) {
  const input = el('input', { type: 'checkbox', name, checked: checked ? 'checked' : undefined });
  return el('label', { class: 'field-mini field-mini-checkbox', title: 'Les transactions de cette catégorie n\u2019apparaîtront pas dans le tableau de bord (utile pour les virements de compte à compte).' }, [
    input,
    el('span', { class: 'field-mini-label' }, ['Ignorer dans le tableau de bord'])
  ]);
}

const TABS = [
  { key: 'accounts', label: 'Comptes' },
  { key: 'cashflows', label: 'Cashflows' },
  { key: 'categories', label: 'Catégories' },
  { key: 'subcategories', label: 'Sous-catégories' },
  { key: 'budget-types', label: 'Types de budget' },
  { key: 'objectives', label: 'Objectifs' }
];

async function renderReferentials(root) {
  root.innerHTML = '';
  const tabBar = el('div', { class: 'filter-row' });
  const body = el('div', { class: 'panel' });
  root.appendChild(el('div', { class: 'dashboard' }, [tabBar, body]));

  let active = 'accounts';

  function buildTabs() {
    tabBar.innerHTML = '';
    for (const t of TABS) {
      tabBar.appendChild(el('button', {
        class: `chip ${active === t.key ? 'chip-active' : ''}`,
        onclick: () => { active = t.key; render(); }
      }, [t.label]));
    }
  }

  async function render() {
    buildTabs();
    body.innerHTML = '<p class="empty-state">Chargement…</p>';
    try {
      if (active === 'accounts') await renderAccounts();
      else if (active === 'cashflows') await renderCashflows();
      else if (active === 'categories') await renderCategories();
      else if (active === 'subcategories') await renderSubcategories();
      else if (active === 'budget-types') await renderBudgetTypes();
      else if (active === 'objectives') await renderObjectives();
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }

  async function renderAccounts() {
    const accounts = await api.get('/api/accounts');
    body.innerHTML = '';
    body.appendChild(el('div', { class: 'panel-header' }, [el('h2', {}, ['Comptes bancaires'])]));
    const list = el('div', { class: 'category-list' });
    for (const a of accounts) {
      list.appendChild(el('div', { class: 'category-row' }, [
        el('div', { class: 'category-meta' }, [
          el('span', { class: 'category-name' }, [a.label]),
          el('span', { class: 'category-subtle' }, [a.referenceMasked])
        ]),
        el('button', {
          class: 'ghost-button',
          onclick: async () => {
            try {
              await api.put(`/api/accounts/${a.id}/archive`, {});
              toast('Compte archivé.', { type: 'success' });
              render();
            } catch (err) { toast(err.message, { type: 'error' }); }
          }
        }, [a.isArchived ? 'Archivé' : 'Archiver'])
      ]));
    }
    body.appendChild(list.children.length ? list : el('p', { class: 'empty-state' }, ['Les comptes apparaissent automatiquement lors du premier import.']));
  }

  async function renderCashflows() {
    const cashflows = await api.get('/api/cashflows');
    body.innerHTML = '';
    body.appendChild(el('div', { class: 'panel-header' }, [el('h2', {}, ['Cashflows'])]));
    const form = el('form', { class: 'filter-row' }, [
      el('input', { name: 'name', placeholder: 'Nom du cashflow', required: 'required' }),
      el('button', { class: 'primary-button', type: 'submit' }, ['Ajouter'])
    ]);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.post('/api/cashflows', { name: e.target.name.value.trim() });
        toast('Cashflow créé.', { type: 'success' });
        render();
      } catch (err) { toast(err.message, { type: 'error' }); }
    });
    body.appendChild(form);
    const list = el('div', { class: 'category-list panel-separator' });
    for (const c of cashflows) {
      list.appendChild(el('div', { class: 'category-row' }, [
        el('div', { class: 'category-meta' }, [
          el('span', { class: 'category-name' }, [c.name]),
          c.is_default ? el('span', { class: 'chip chip-active' }, ['Par défaut']) : el('span', {})
        ]),
        !c.is_default ? el('button', {
          class: 'ghost-button',
          onclick: async () => {
            try {
              await api.put(`/api/cashflows/${c.id}/set-default`, {});
              toast('Cashflow défini par défaut.', { type: 'success' });
              render();
            } catch (err) { toast(err.message, { type: 'error' }); }
          }
        }, ['Définir par défaut']) : el('span', {})
      ]));
    }
    body.appendChild(list.children.length ? list : el('p', { class: 'empty-state' }, ['Aucun cashflow pour le moment.']));
  }

  async function renderCategories() {
    const [categories, budgetTypeResult] = await Promise.all([api.get('/api/categories'), api.get('/api/budget-types')]);
    const budgetTypes = budgetTypeResult.items || budgetTypeResult;
    body.innerHTML = '';
    body.appendChild(el('div', { class: 'panel-header' }, [el('h2', {}, ['Catégories'])]));
    const newBudgetTypeSelect = budgetTypeSelect('budgetTypeId', budgetTypes, '');
    const newExcludeField = excludeFromDashboardField('excludeFromDashboard', false);
    const form = el('form', { class: 'filter-row' }, [
      el('input', { name: 'name', placeholder: 'Nom', required: 'required' }),
      el('input', { name: 'color', type: 'color', value: '#2563eb' }),
      iconSelect('icon', ''),
      labeledField('Type de budget (pour les dépenses)', newBudgetTypeSelect),
      newExcludeField,
      el('button', { class: 'primary-button', type: 'submit' }, ['Ajouter'])
    ]);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.post('/api/categories', {
          name: e.target.name.value.trim(),
          color: e.target.color.value,
          icon: e.target.icon.value || null,
          budgetTypeId: e.target.budgetTypeId.value || null,
          excludeFromDashboard: e.target.excludeFromDashboard.checked
        });
        toast('Catégorie créée.', { type: 'success' });
        render();
      } catch (err) { toast(err.message, { type: 'error' }); }
    });
    body.appendChild(form);
    const list = el('div', { class: 'category-list panel-separator' });
    for (const c of categories) {
      const editRowFields = [
        labeledField('Icône', iconSelect('icon', c.icon || '')),
        labeledField('Type de budget (pour les dépenses)', budgetTypeSelect('budgetTypeId', budgetTypes, c.budget_type_id || ''))
      ];
      editRowFields.push(excludeFromDashboardField('excludeFromDashboard', !!c.exclude_from_dashboard));
      const editRow = el('div', { class: 'filter-row' }, editRowFields);
      if (!c.is_system) {
        editRow.querySelector('select[name="icon"]').addEventListener('change', async (e) => {
          try {
            await api.put(`/api/categories/${c.id}`, { icon: e.target.value || null });
            toast('Icône mise à jour.', { type: 'success' });
          } catch (err) { toast(err.message, { type: 'error' }); }
        });
        editRow.querySelector('select[name="budgetTypeId"]')?.addEventListener('change', async (e) => {
          try {
            await api.put(`/api/categories/${c.id}`, { budgetTypeId: e.target.value || null });
            toast('Type de budget mis à jour.', { type: 'success' });
          } catch (err) { toast(err.message, { type: 'error' }); }
        });
        editRow.querySelector('input[name="excludeFromDashboard"]').addEventListener('change', async (e) => {
          try {
            await api.put(`/api/categories/${c.id}`, { excludeFromDashboard: e.target.checked });
            toast('Catégorie mise à jour.', { type: 'success' });
            render();
          } catch (err) { toast(err.message, { type: 'error' }); }
        });
      } else {
        editRow.querySelectorAll('select, input').forEach((s) => { s.disabled = true; });
      }
      list.appendChild(el('div', { class: 'category-row' }, [
        el('div', { class: 'category-meta' }, [
          el('span', { class: 'dot', style: `background:${c.color}` }),
          el('span', { class: 'category-name' }, [`${c.icon ? c.icon + ' ' : ''}${c.name}`]),
          c.exclude_from_dashboard ? el('span', { class: 'chip chip-warning' }, ['Ignorée (tableau de bord)']) : null
        ].filter(Boolean)),
        editRow,
        c.is_system ? el('span', { class: 'chip' }, ['Système']) : el('button', {
          class: 'ghost-button',
          onclick: async () => {
            if (!confirm('Supprimer cette catégorie ?')) return;
            try {
              await api.del(`/api/categories/${c.id}`);
              toast('Catégorie supprimée.', { type: 'success' });
              render();
            } catch (err) { toast(err.message, { type: 'error' }); }
          }
        }, ['Supprimer'])
      ]));
    }
    body.appendChild(list);
  }

  async function renderSubcategories() {
    const [categories, subcategories, budgetTypeResult] = await Promise.all([
      api.get('/api/categories'), api.get('/api/subcategories'), api.get('/api/budget-types')
    ]);
    const budgetTypes = budgetTypeResult.items || budgetTypeResult;
    body.innerHTML = '';
    body.appendChild(el('div', { class: 'panel-header' }, [el('h2', {}, ['Sous-catégories'])]));
    const categorySelect = el('select', { name: 'categoryId', required: 'required' }, [el('option', { value: '' }, ['Catégorie…']), ...categories.map((c) => el('option', { value: c.id }, [c.name]))]);
    const newBudgetTypeSelect = budgetTypeSelect('budgetTypeId', budgetTypes, '');
    const form = el('form', { class: 'filter-row' }, [
      categorySelect,
      el('input', { name: 'name', placeholder: 'Nom', required: 'required' }),
      iconSelect('icon', ''),
      labeledField('Type de budget (pour les dépenses)', newBudgetTypeSelect),
      el('button', { class: 'primary-button', type: 'submit' }, ['Ajouter'])
    ]);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.post('/api/subcategories', {
          categoryId: e.target.categoryId.value,
          name: e.target.name.value.trim(),
          icon: e.target.icon.value || null,
          budgetTypeId: e.target.budgetTypeId.value || null
        });
        toast('Sous-catégorie créée.', { type: 'success' });
        render();
      } catch (err) { toast(err.message, { type: 'error' }); }
    });
    body.appendChild(form);
    const list = el('div', { class: 'category-list panel-separator' });
    for (const s of subcategories) {
      const cat = categories.find((c) => c.id === s.category_id);
      const editRowFields = [
        labeledField('Icône', iconSelect('icon', s.icon || '')),
        labeledField('Type de budget (pour les dépenses)', budgetTypeSelect('budgetTypeId', budgetTypes, s.budget_type_id || ''))
      ];
      const editRow = el('div', { class: 'filter-row' }, editRowFields);
      if (!s.is_system) {
        editRow.querySelector('select[name="icon"]').addEventListener('change', async (e) => {
          try {
            await api.put(`/api/subcategories/${s.id}`, { icon: e.target.value || null });
            toast('Icône mise à jour.', { type: 'success' });
          } catch (err) { toast(err.message, { type: 'error' }); }
        });
        editRow.querySelector('select[name="budgetTypeId"]')?.addEventListener('change', async (e) => {
          try {
            await api.put(`/api/subcategories/${s.id}`, { budgetTypeId: e.target.value || null });
            toast('Type de budget mis à jour.', { type: 'success' });
          } catch (err) { toast(err.message, { type: 'error' }); }
        });
      } else {
        editRow.querySelectorAll('select').forEach((sel) => { sel.disabled = true; });
      }
      list.appendChild(el('div', { class: 'category-row' }, [
        el('div', { class: 'category-meta' }, [
          el('span', { class: 'category-name' }, [`${s.icon ? s.icon + ' ' : ''}${s.name}`]),
          el('span', { class: 'category-subtle' }, [cat ? cat.name : ''])
        ]),
        editRow,
        s.is_system ? el('span', { class: 'chip' }, ['Système']) : el('button', {
          class: 'ghost-button',
          onclick: async () => {
            if (!confirm('Supprimer cette sous-catégorie ?')) return;
            try {
              await api.del(`/api/subcategories/${s.id}`);
              toast('Sous-catégorie supprimée.', { type: 'success' });
              render();
            } catch (err) { toast(err.message, { type: 'error' }); }
          }
        }, ['Supprimer'])
      ]));
    }
    body.appendChild(list);
  }

  async function renderBudgetTypes() {
    const result = await api.get('/api/budget-types');
    body.innerHTML = '';
    body.appendChild(el('div', { class: 'panel-header' }, [el('h2', {}, ['Types de budget'])]));

    const createForm = el('form', { class: 'filter-row' }, [
      el('input', { name: 'name', placeholder: 'Nom', required: 'required' }),
      el('input', { name: 'color', type: 'color', value: '#64748b' }),
      el('input', { name: 'percentage', type: 'number', min: '0', max: '100', placeholder: '%', value: '0', required: 'required' }),
      el('button', { class: 'primary-button', type: 'submit' }, ['Ajouter'])
    ]);
    createForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.post('/api/budget-types', {
          name: e.target.name.value.trim(),
          color: e.target.color.value,
          percentage: Number(e.target.percentage.value)
        });
        toast('Type de budget créé.', { type: 'success' });
        render();
      } catch (err) { toast(err.message, { type: 'error' }); }
    });
    body.appendChild(createForm);

    // A 0% type (e.g. "Frais pro") is deliberately excluded from the 100% requirement.
    const sumBanner = el('p', { class: 'category-subtle' });
    const percentInputs = [];
    const updateSumBanner = () => {
      const sum = percentInputs.reduce((total, { input }) => {
        const v = Number(input.value) || 0;
        return v > 0 ? total + v : total;
      }, 0);
      sumBanner.textContent = sum === 100
        ? `Somme des pourcentages (hors 0%) : ${sum}% ✓`
        : `Somme des pourcentages (hors 0%) : ${sum}% — doit être égale à 100% pour enregistrer.`;
      sumBanner.className = sum === 100 ? 'category-subtle' : 'warning-box';
    };

    const list = el('div', { class: 'category-list panel-separator' });
    for (const b of result.items) {
      const percentInput = el('input', { type: 'number', min: '0', max: '100', value: String(b.percentage), style: 'width:80px' });
      percentInput.addEventListener('input', updateSumBanner);
      percentInputs.push({ id: b.id, input: percentInput });

      list.appendChild(el('div', { class: 'category-row' }, [
        el('div', { class: 'category-meta' }, [
          el('span', { class: 'dot', style: `background:${b.color}` }),
          el('span', { class: 'category-name' }, [b.name]),
          labeledField('Pourcentage', percentInput)
        ]),
        b.is_default ? el('span', { class: 'chip' }, ['Par défaut']) : el('button', {
          class: 'ghost-button',
          onclick: async () => {
            if (!confirm('Supprimer ce type de budget ?')) return;
            try {
              await api.del(`/api/budget-types/${b.id}`);
              toast('Type de budget supprimé.', { type: 'success' });
              render();
            } catch (err) { toast(err.message, { type: 'error' }); }
          }
        }, ['Supprimer'])
      ]));
    }
    body.appendChild(sumBanner);
    body.appendChild(list);
    updateSumBanner();

    const saveButton = el('button', {
      class: 'primary-button',
      onclick: async () => {
        const updates = percentInputs.map(({ id, input }) => ({ id, percentage: Number(input.value) }));
        try {
          await api.put('/api/budget-types/percentages', { updates });
          toast('Pourcentages enregistrés.', { type: 'success' });
          render();
        } catch (err) { toast(err.message, { type: 'error' }); }
      }
    }, ['Enregistrer les pourcentages']);
    body.appendChild(saveButton);
  }

  async function renderObjectives() {
    const [objectives, budgetTypeResult] = await Promise.all([api.get('/api/objectives'), api.get('/api/budget-types')]);
    const budgetTypes = budgetTypeResult.items || budgetTypeResult;
    body.innerHTML = '';
    body.appendChild(el('div', { class: 'panel-header' }, [el('h2', {}, ['Objectifs du foyer'])]));
    const form = el('form', { class: 'filter-row' }, [
      el('input', { name: 'name', placeholder: "Nom de l'objectif", required: 'required' }),
      el('input', { name: 'targetMonth', type: 'month', required: 'required' }),
      el('select', { name: 'budgetTypeId', required: 'required' }, [
        el('option', { value: '' }, ['Type de budget…']),
        ...budgetTypes.map((b) => el('option', { value: b.id }, [b.name]))
      ]),
      el('input', { name: 'percentage', type: 'number', min: '0', max: '100', placeholder: '% objectif', required: 'required' }),
      el('button', { class: 'primary-button', type: 'submit' }, ['Ajouter'])
    ]);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.post('/api/objectives', {
          name: e.target.name.value.trim(),
          targetMonth: `${e.target.targetMonth.value}-01`,
          budgetTypeId: e.target.budgetTypeId.value,
          percentage: Number(e.target.percentage.value)
        });
        toast('Objectif ajouté.', { type: 'success' });
        render();
      } catch (err) { toast(err.message, { type: 'error' }); }
    });
    body.appendChild(form);
    const list = el('div', { class: 'category-list panel-separator' });
    for (const o of objectives) {
      const bt = budgetTypes.find((b) => b.id === o.budget_type_id);
      list.appendChild(el('div', { class: 'category-row' }, [
        el('div', { class: 'category-meta' }, [
          el('span', { class: 'category-name' }, [o.name]),
          el('span', { class: 'category-subtle' }, [`${bt ? bt.name : ''} · ${o.percentage}% · ${o.target_month?.slice(0, 7) || ''}`])
        ]),
        el('button', {
          class: 'ghost-button',
          onclick: async () => {
            try {
              await api.del(`/api/objectives/${o.id}`);
              toast('Objectif supprimé.', { type: 'success' });
              render();
            } catch (err) { toast(err.message, { type: 'error' }); }
          }
        }, ['Supprimer'])
      ]));
    }
    body.appendChild(list);
  }

  await render();
}

export { renderReferentials };
