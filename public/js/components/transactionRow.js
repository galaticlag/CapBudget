'use strict';

import { api } from '../api.js';
import { el, formatCents, formatDate } from '../util.js';
import { toast } from '../toast.js';

function labeledField(label, field) {
  return el('div', { class: 'field-mini' }, [el('span', { class: 'field-mini-label' }, [label]), field]);
}

// Shared row renderer used by both the dashboard's transaction panel and the
// full transactions management view, so both stay visually/behaviorally
// identical and only need to be maintained in one place.
const IGNORE_CASHFLOW_VALUE = '__ignore__';

function renderTransactionRow(t, ctx) {
  const {
    categories,
    subcategoriesByCategory,
    categoryById,
    budgetTypeById,
    accountById = new Map(),
    cashflows = [],
    onChange = () => {}
  } = ctx;

  const isExpense = t.nature === 'EXPENSE';

  async function patch(payload, successMessage) {
    try {
      await api.put(`/api/transactions/${t.id}`, payload);
      if (successMessage) toast(successMessage, { type: 'success' });
      onChange();
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }

  function subcategoryOptionsFor(categoryId, selectedId) {
    const subs = (subcategoriesByCategory.get(categoryId) || [])
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr', { sensitivity: 'base' }));
    return [
      el('option', { value: '', selected: !selectedId ? 'selected' : undefined }, ['Sous-catégorie…']),
      ...subs.map((s) => el('option', { value: s.id, selected: s.id === selectedId ? 'selected' : undefined }, [s.name]))
    ];
  }

  const subcategorySelect = el('select', {
    onchange: (e) => patch({ subcategoryId: e.target.value || null }, 'Sous-catégorie mise à jour.')
  }, subcategoryOptionsFor(t.category_id, t.subcategory_id));

  const sortedCategories = (categories || []).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr', { sensitivity: 'base' }));

  const categorySelect = el('select', {
    onchange: (e) => {
      const newCategoryId = e.target.value;
      // The previous subcategory no longer applies to the new category: clear
      // it immediately and force the user to pick a fresh one.
      subcategorySelect.innerHTML = '';
      for (const opt of subcategoryOptionsFor(newCategoryId, null)) subcategorySelect.appendChild(opt);
      patch({ categoryId: newCategoryId, subcategoryId: null }, 'Catégorie mise à jour.');
    }
  }, sortedCategories.map((c) => el('option', { value: c.id, selected: c.id === t.category_id ? 'selected' : undefined }, [c.name])));

  const category = categoryById.get(t.category_id);
  const budgetType = category && category.budget_type_id ? budgetTypeById.get(category.budget_type_id) : null;
  const donutPercent = budgetType ? Number(budgetType.percentage) || 0 : 0;
  const donutColor = budgetType ? (budgetType.color || '#3b82f6') : 'rgba(148,163,184,0.35)';
  const donutAngle = Math.min(360, Math.max(0, (donutPercent / 100) * 360));
  const donut = el('div', {
    class: 'mini-donut',
    title: budgetType ? `${budgetType.name} · cible ${donutPercent}%` : 'Aucun type de budget',
    style: `background: conic-gradient(${donutColor} 0 ${donutAngle}deg, rgba(148,163,184,0.18) ${donutAngle}deg 360deg);`
  }, [el('span', { class: 'mini-donut-label' }, [budgetType ? `${Math.round(donutPercent)}%` : '—'])]);

  // Extra context to help decide how to categorize: bank-suggested label and source account.
  const account = accountById.get(t.account_id);
  const decisionDetails = [];
  if (t.suggested_label && t.suggested_label !== t.raw_label) decisionDetails.push(`Suggéré : ${t.suggested_label}`);
  if (account) decisionDetails.push(account.label || account.referenceMasked || '');

  const commentInput = el('input', {
    type: 'text',
    class: 'transaction-comment-input',
    placeholder: 'Commentaire…',
    value: t.comment || '',
    onchange: (e) => patch({ comment: e.target.value.trim() || null }, 'Commentaire mis à jour.')
  });

  const cashflowSelect = el('select', {
    onchange: (e) => {
      const value = e.target.value;
      if (value === IGNORE_CASHFLOW_VALUE) {
        patch({ excludedFromCashflow: true }, 'Transaction ignorée sur le CashFlow.');
      } else {
        patch({ cashflowId: value, excludedFromCashflow: false }, 'Cashflow mis à jour.');
      }
    }
  }, [
    ...cashflows.map((c) => el('option', {
      value: c.id,
      selected: (!t.excluded_from_cashflow && c.id === t.cashflow_id) ? 'selected' : undefined
    }, [c.name])),
    el('option', { value: IGNORE_CASHFLOW_VALUE, selected: t.excluded_from_cashflow ? 'selected' : undefined }, ['Ignorer sur CashFlow'])
  ]);

  const archiveButton = el('button', {
    class: 'ghost-button',
    onclick: async () => {
      if (t.source !== 'MANUAL' && !confirm('Archiver cette transaction ?')) return;
      try {
        if (t.source === 'MANUAL') await api.del(`/api/transactions/${t.id}`);
        else await api.put(`/api/transactions/${t.id}/archive`, {});
        onChange();
      } catch (err) { toast(err.message, { type: 'error' }); }
    }
  }, [t.source === 'MANUAL' ? 'Supprimer' : 'Archiver']);

  return el('div', { class: `transaction-row${t.excluded_from_cashflow ? ' cashflow-excluded' : ''}` }, [
    el('div', { class: 'transaction-main' }, [
      el('span', { class: 'transaction-label' }, [t.raw_label]),
      el('span', { class: 'transaction-sub' }, [`${formatDate(t.operation_date)} · ${t.source === 'MANUAL' ? 'Manuelle' : 'Import'}${t.is_manually_edited ? ' · modifiée' : ''}`]),
      decisionDetails.length ? el('span', { class: 'transaction-sub' }, [decisionDetails.join(' · ')]) : null
    ].filter(Boolean)),
    labeledField('Catégorie', categorySelect),
    labeledField('Sous-catégorie', subcategorySelect),
    labeledField('Cashflow', cashflowSelect),
    labeledField('Commentaire', commentInput),
    el('div', { class: 'transaction-right' }, [
      donut,
      el('span', { class: `transaction-amount ${isExpense ? 'amount-expense' : 'amount-income'}` }, [formatCents(t.amount_cents)]),
      archiveButton
    ])
  ]);
}

export { renderTransactionRow };
