'use strict';

import { api } from '../api.js';
import { el } from '../util.js';
import { toast } from '../toast.js';
import { renderTransactionRow } from '../components/transactionRow.js';

function parseHashQuery() {
  const hash = window.location.hash;
  const qIndex = hash.indexOf('?');
  if (qIndex === -1) return {};
  return Object.fromEntries(new URLSearchParams(hash.slice(qIndex + 1)));
}

async function renderTransactions(root) {
  root.innerHTML = '';
  const initialQuery = parseHashQuery();

  const filters = {
    startMonth: initialQuery.startMonth || '',
    endMonth: initialQuery.endMonth || '',
    categoryId: initialQuery.categoryId || '',
    nature: '',
    status: 'ACTIVE',
    search: ''
  };

  let categories = [];
  let cashflows = [];
  let budgetTypes = [];
  let accounts = [];
  let subcategoriesByCategory = new Map();
  try {
    [categories, cashflows, budgetTypes, accounts] = await Promise.all([
      api.get('/api/categories'),
      api.get('/api/cashflows'),
      api.get('/api/budget-types'),
      api.get('/api/accounts')
    ]);
    const subcats = await api.get('/api/subcategories');
    for (const s of subcats) {
      if (!subcategoriesByCategory.has(s.category_id)) subcategoriesByCategory.set(s.category_id, []);
      subcategoriesByCategory.get(s.category_id).push(s);
    }
  } catch (err) {
    toast(err.message, { type: 'error' });
  }

  const budgetTypeById = new Map((budgetTypes.items || budgetTypes).map((bt) => [bt.id, bt]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const filterPanel = el('div', { class: 'panel' });
  const tablePanel = el('div', { class: 'panel' });
  const addFormPanel = el('div', { class: 'panel' });

  root.appendChild(el('div', { class: 'dashboard' }, [addFormPanel, filterPanel, tablePanel]));

  function categoryOptions() {
    return categories.map((c) => el('option', { value: c.id }, [c.name]));
  }

  function buildFilterPanel() {
    filterPanel.innerHTML = '';
    filterPanel.appendChild(el('div', { class: 'filter-row' }, [
      el('input', { type: 'month', value: filters.startMonth, placeholder: 'Début', onchange: (e) => { filters.startMonth = e.target.value; loadResults(); } }),
      el('input', { type: 'month', value: filters.endMonth, placeholder: 'Fin', onchange: (e) => { filters.endMonth = e.target.value; loadResults(); } }),
      el('select', { onchange: (e) => { filters.nature = e.target.value; loadResults(); } }, [
        el('option', { value: '', selected: filters.nature === '' ? 'selected' : undefined }, ['Toutes natures']),
        el('option', { value: 'REVENUE', selected: filters.nature === 'REVENUE' ? 'selected' : undefined }, ['Revenu']),
        el('option', { value: 'EXPENSE', selected: filters.nature === 'EXPENSE' ? 'selected' : undefined }, ['Dépense']),
        el('option', { value: 'TRANSFER', selected: filters.nature === 'TRANSFER' ? 'selected' : undefined }, ['Virement'])
      ]),
      el('select', { onchange: (e) => { filters.categoryId = e.target.value; loadResults(); } }, [
        el('option', { value: '', selected: filters.categoryId === '' ? 'selected' : undefined }, ['Toutes catégories']),
        ...categories.map((c) => el('option', { value: c.id, selected: c.id === filters.categoryId ? 'selected' : undefined }, [c.name]))
      ]),
      el('select', { onchange: (e) => { filters.status = e.target.value; loadResults(); } }, [
        el('option', { value: 'ACTIVE', selected: filters.status === 'ACTIVE' ? 'selected' : undefined }, ['Actives']),
        el('option', { value: 'ARCHIVED', selected: filters.status === 'ARCHIVED' ? 'selected' : undefined }, ['Archivées'])
      ]),
      el('input', { type: 'search', placeholder: 'Recherche libre…', value: filters.search, oninput: debounce((e) => { filters.search = e.target.value; loadResults(); }, 350) })
    ]));
  }

  function debounce(fn, wait) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };
  }

  addFormPanel.appendChild(el('div', { class: 'panel-header' }, [el('h2', {}, ['Nouvelle transaction manuelle'])]));
  const addForm = el('form', { class: 'filter-row', id: 'add-txn-form' }, [
    el('input', { type: 'date', name: 'operationDate', required: 'required' }),
    el('input', { type: 'text', name: 'label', placeholder: 'Libellé', required: 'required' }),
    el('input', { type: 'number', step: '0.01', name: 'amount', placeholder: 'Montant (+/-)', required: 'required' }),
    el('select', { name: 'categoryId', required: 'required' }, [el('option', { value: '' }, ['Catégorie…']), ...categoryOptions()]),
    el('select', { name: 'nature' }, [
      el('option', { value: 'EXPENSE' }, ['Dépense']),
      el('option', { value: 'REVENUE' }, ['Revenu']),
      el('option', { value: 'TRANSFER' }, ['Virement'])
    ]),
    el('button', { class: 'primary-button', type: 'submit' }, ['Ajouter'])
  ]);
  addForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    const amountCents = Math.round(parseFloat(form.amount.value.replace(',', '.')) * 100);
    try {
      await api.post('/api/transactions', {
        operationDate: form.operationDate.value,
        label: form.label.value.trim(),
        amountCents,
        categoryId: form.categoryId.value,
        nature: form.nature.value
      });
      toast('Transaction ajoutée.', { type: 'success' });
      form.reset();
      loadResults();
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  });
  addFormPanel.appendChild(addForm);

  // Only the results panel is refreshed on filter changes; the filter panel itself
  // is built once so inputs (in particular the debounced search field) keep focus
  // and their current value instead of being torn down on every keystroke.
  async function loadResults() {
    let rows = [];
    try {
      rows = await api.get('/api/transactions', { query: { ...filters, limit: 300 } });
    } catch (err) {
      toast(err.message, { type: 'error' });
      return;
    }

    tablePanel.innerHTML = '';
    tablePanel.appendChild(el('div', { class: 'panel-header' }, [el('h2', {}, [`Transactions (${rows.length})`])]));

    if (rows.length === 0) {
      tablePanel.appendChild(el('p', { class: 'empty-state' }, ['Aucune transaction sur ce filtre.']));
      return;
    }

    const list = el('div', { class: 'transaction-list' });
    for (const t of rows) {
      list.appendChild(renderTransactionRow(t, {
        categories, subcategoriesByCategory, categoryById, budgetTypeById, accountById, cashflows, onChange: loadResults
      }));
    }
    tablePanel.appendChild(list);
  }

  function load() {
    buildFilterPanel();
    return loadResults();
  }

  await load();
}

export { renderTransactions };
