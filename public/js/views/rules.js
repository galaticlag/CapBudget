'use strict';

import { api } from '../api.js';
import { el } from '../util.js';
import { toast } from '../toast.js';

async function renderRules(root) {
  root.innerHTML = '';
  const listPanel = el('div', { class: 'panel' });
  const formPanel = el('div', { class: 'panel' });
  const reprocessPanel = el('div', { class: 'panel' });
  root.appendChild(el('div', { class: 'dashboard' }, [formPanel, listPanel, reprocessPanel]));

  let categories = [];
  let cashflows = [];
  let subcategories = [];
  try {
    [categories, cashflows, subcategories] = await Promise.all([
      api.get('/api/categories'),
      api.get('/api/cashflows'),
      api.get('/api/subcategories')
    ]);
  } catch (err) { toast(err.message, { type: 'error' }); }

  const subcategoriesByCategory = new Map();
  for (const s of subcategories) {
    if (!subcategoriesByCategory.has(s.category_id)) subcategoriesByCategory.set(s.category_id, []);
    subcategoriesByCategory.get(s.category_id).push(s);
  }

    categories = categories.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr', { sensitivity: 'base' }));
    for (const [catId, subs] of subcategoriesByCategory.entries()) {
      subcategoriesByCategory.set(catId, subs.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr', { sensitivity: 'base' })));
    }

  function subcategoryOptionsFor(categoryId) {
    const subs = subcategoriesByCategory.get(categoryId) || [];
    return [
      el('option', { value: '' }, ['Sous-catégorie (optionnel)']),
      ...subs.map((s) => el('option', { value: s.id }, [s.name]))
    ];
  }

  formPanel.appendChild(el('div', { class: 'panel-header' }, [el('h2', {}, ['Nouvelle règle de catégorisation'])]));
  const matchRawCheckbox = el('input', { type: 'checkbox', name: 'matchRawLabel', checked: 'checked' });
  const matchSuggestedCheckbox = el('input', { type: 'checkbox', name: 'matchSuggestedLabel' });
  const matchCommentCheckbox = el('input', { type: 'checkbox', name: 'matchComment' });
  const categorySelect = el('select', { name: 'categoryId', required: 'required' }, [
    el('option', { value: '' }, ['Catégorie…']),
    ...categories.map((c) => el('option', { value: c.id }, [c.name]))
  ]);
  const subcategorySelect = el('select', { name: 'subcategoryId' }, subcategoryOptionsFor(''));
  categorySelect.addEventListener('change', () => {
    subcategorySelect.innerHTML = '';
    for (const opt of subcategoryOptionsFor(categorySelect.value)) subcategorySelect.appendChild(opt);
  });
  const form = el('form', { class: 'filter-row', id: 'rule-form' }, [
    el('input', { name: 'name', placeholder: 'Nom de la règle', required: 'required' }),
    el('div', { class: 'filter-row', title: 'Comparer la valeur recherchée sur un ou plusieurs de ces champs à la fois (utile pour les changements en masse).' }, [
      el('label', { class: 'field-mini field-mini-checkbox' }, [matchRawCheckbox, el('span', { class: 'field-mini-label' }, ['Libellé brut'])]),
      el('label', { class: 'field-mini field-mini-checkbox' }, [matchSuggestedCheckbox, el('span', { class: 'field-mini-label' }, ['Libellé suggéré'])]),
      el('label', { class: 'field-mini field-mini-checkbox' }, [matchCommentCheckbox, el('span', { class: 'field-mini-label' }, ['Commentaire'])])
    ]),
    el('select', { name: 'matchType' }, [
      el('option', { value: 'CONTAINS' }, ['Contient']),
      el('option', { value: 'EQUALS' }, ['Égal à']),
      el('option', { value: 'REGEX' }, ['Expression régulière'])
    ]),
    el('input', { name: 'matchValue', placeholder: 'Valeur à rechercher', required: 'required' }),
    categorySelect,
    subcategorySelect,
    el('select', { name: 'cashflowId' }, [
      el('option', { value: '' }, ['Cashflow (optionnel)']),
      ...cashflows.map((c) => el('option', { value: c.id }, [c.name]))
    ]),
    el('button', { class: 'primary-button', type: 'submit' }, ['Créer'])
  ]);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const f = event.target;
    if (!matchRawCheckbox.checked && !matchSuggestedCheckbox.checked && !matchCommentCheckbox.checked) {
      toast('Sélectionnez au moins un champ à comparer.', { type: 'error' });
      return;
    }
    try {
      await api.post('/api/rules', {
        name: f.name.value.trim(),
        matchRawLabel: matchRawCheckbox.checked,
        matchSuggestedLabel: matchSuggestedCheckbox.checked,
        matchComment: matchCommentCheckbox.checked,
        matchType: f.matchType.value,
        matchValue: f.matchValue.value.trim(),
        categoryId: f.categoryId.value,
        subcategoryId: f.subcategoryId.value || null,
        cashflowId: f.cashflowId.value || null
      });
      toast('Règle créée.', { type: 'success' });
      f.reset();
      matchRawCheckbox.checked = true;
      subcategorySelect.innerHTML = '';
      for (const opt of subcategoryOptionsFor('')) subcategorySelect.appendChild(opt);
      loadRules();
      loadReprocessPreview();
    } catch (err) { toast(err.message, { type: 'error' }); }
  });
  formPanel.appendChild(form);

  async function loadRules() {
    let rules = [];
    try { rules = await api.get('/api/rules'); } catch (err) { toast(err.message, { type: 'error' }); return; }
    listPanel.innerHTML = '';
    listPanel.appendChild(el('div', { class: 'panel-header' }, [el('h2', {}, [`Règles actives (${rules.length})`])]));
    const list = el('div', { class: 'category-list' });
    for (const r of rules) {
      const cat = categories.find((c) => c.id === r.category_id);
      const sub = subcategories.find((s) => s.id === r.subcategory_id);
      const fields = [
        r.match_raw_label ? 'libellé brut' : null,
        r.match_suggested_label ? 'libellé suggéré' : null,
        r.match_comment ? 'commentaire' : null
      ].filter(Boolean).join(' + ');
      list.appendChild(el('div', { class: 'category-row' }, [
        el('div', { class: 'category-meta' }, [
          el('span', { class: 'category-name' }, [r.name]),
          el('span', { class: 'category-subtle' }, [
            `${fields} ${r.match_type} "${r.match_value}" → ${cat ? cat.name : '?'}${sub ? ' / ' + sub.name : ''}`
          ])
        ]),
        el('button', {
          class: 'ghost-button',
          onclick: async () => {
            try {
              await api.del(`/api/rules/${r.id}`);
              toast('Règle supprimée.', { type: 'success' });
              loadRules();
              loadReprocessPreview();
            } catch (err) { toast(err.message, { type: 'error' }); }
          }
        }, ['Supprimer'])
      ]));
    }
    listPanel.appendChild(list);
  }

  reprocessPanel.appendChild(el('div', { class: 'panel-header' }, [el('h2', {}, ['Retraitement historique'])]));
  const reprocessBody = el('div', { class: 'stack-form' });
  reprocessPanel.appendChild(reprocessBody);

  async function loadReprocessPreview() {
    let plan;
    try { plan = await api.get('/api/rules/reprocess/preview'); } catch (err) { toast(err.message, { type: 'error' }); return; }
    reprocessBody.innerHTML = '';
    reprocessBody.appendChild(el('p', {}, [
      `${plan.eligibleCount} transaction(s) seraient mises à jour. ${plan.skippedManualCount} modifiée(s) manuellement seraient ignorée(s) par défaut.`
    ]));
    const overwriteCheckbox = el('input', { type: 'checkbox', id: 'overwrite-manual' });
    reprocessBody.appendChild(el('label', {}, [overwriteCheckbox, ' Écraser aussi les transactions modifiées manuellement']));
    reprocessBody.appendChild(el('button', {
      class: 'primary-button',
      onclick: async () => {
        try {
          const result = await api.post('/api/rules/reprocess/apply', { overwriteManual: overwriteCheckbox.checked });
          toast(`${result.appliedCount} transaction(s) mise(s) à jour.`, { type: 'success' });
          loadReprocessPreview();
        } catch (err) { toast(err.message, { type: 'error' }); }
      }
    }, ['Appliquer le retraitement']));
  }

  await loadRules();
  await loadReprocessPreview();
}

export { renderRules };
