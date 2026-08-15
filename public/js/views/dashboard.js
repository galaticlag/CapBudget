'use strict';

import { api } from '../api.js';
import { el, formatCents, currentMonthStr } from '../util.js';
import { renderSankey } from '../sankey.js';
import { toast } from '../toast.js';
import { renderTransactionRow } from '../components/transactionRow.js';

const MONTH_SHORTCUTS = [
  { label: '1 mois', months: 1 },
  { label: '2 mois', months: 2 },
  { label: '3 mois', months: 3 },
  { label: '6 mois', months: 6 },
  { label: '12 mois', months: 12 }
];

async function renderDashboard(root) {
  root.innerHTML = '';

  const filterState = {
    startMonth: currentMonthStr(),
    endMonth: currentMonthStr(),
    cashflowId: '',
    activeShortcut: 1
  };

  const filtersBar = el('div', { class: 'panel', id: 'dash-filters' });
  const summaryGrid = el('div', { class: 'summary-grid', id: 'dash-summary' });
  const budgetTypePanel = el('div', { class: 'panel', id: 'dash-budget-types' });
  const sankeyPanel = el('div', { class: 'panel sankey-panel' }, [
    el('div', { class: 'panel-header' }, [el('h2', {}, ['Flux du foyer'])]),
    el('div', { class: 'sankey-container', id: 'sankey-container' })
  ]);
  const transactionsPanel = el('div', { class: 'panel', id: 'dash-transactions' });

  root.appendChild(el('div', { class: 'dashboard' }, [filtersBar, summaryGrid, budgetTypePanel, sankeyPanel, transactionsPanel]));

  let cashflows = [];
  let categories = [];
  let budgetTypes = [];
  let accounts = [];
  let subcategoriesByCategory = new Map();
  try {
    [cashflows, categories, budgetTypes, accounts] = await Promise.all([
      api.get('/api/cashflows'),
      api.get('/api/categories'),
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

  function buildFilters() {
    filtersBar.innerHTML = '';
    const shortcutRow = el('div', { class: 'filter-row' },
      MONTH_SHORTCUTS.map((s) => el('button', {
        class: `chip ${filterState.activeShortcut === s.months ? 'chip-active' : ''}`,
        onclick: () => {
          filterState.activeShortcut = s.months;
          filterState.startMonth = currentMonthStr(-(s.months - 1));
          filterState.endMonth = currentMonthStr();
          load();
        }
      }, [s.label]))
    );

    const customRow = el('div', { class: 'filter-row' }, [
      el('label', {}, ['Du']),
      el('input', {
        type: 'month', value: filterState.startMonth,
        onchange: (e) => { filterState.activeShortcut = null; filterState.startMonth = e.target.value; load(); }
      }),
      el('label', {}, ['au']),
      el('input', {
        type: 'month', value: filterState.endMonth,
        onchange: (e) => { filterState.activeShortcut = null; filterState.endMonth = e.target.value; load(); }
      }),
      el('label', {}, ['Cashflow']),
      el('select', {
        value: filterState.cashflowId,
        onchange: (e) => { filterState.cashflowId = e.target.value; load(); }
      }, [
        el('option', { value: '', selected: filterState.cashflowId === '' ? 'selected' : undefined }, ['Tous']),
        ...cashflows.map((c) => el('option', {
          value: c.id,
          selected: String(filterState.cashflowId) === String(c.id) ? 'selected' : undefined
        }, [c.name]))
      ])
    ]);

    filtersBar.appendChild(el('div', { class: 'stack-form' }, [shortcutRow, customRow]));
  }

  function renderBudgetTypePanel(budgetTypeData) {
    budgetTypePanel.innerHTML = '';
    budgetTypePanel.appendChild(el('div', { class: 'panel-header' }, [el('h2', {}, ['Répartition par type de budget'])]));
    if (!budgetTypeData || budgetTypeData.items.length === 0) {
      budgetTypePanel.appendChild(el('p', { class: 'empty-state' }, ['Aucun type de budget actif.']));
      return;
    }
    const rows = el('div', { class: 'stack-form' });
    for (const item of budgetTypeData.items) {
      const actual = Math.round(item.actualPercentage * 10) / 10;
      const target = item.targetPercentage;
      const varianceRounded = Math.round(item.variancePoints * 10) / 10;
      const varianceClass = Math.abs(varianceRounded) < 1 ? 'chip-success' : (varianceRounded > 0 ? 'chip-danger' : 'chip-warning');
      const varianceLabel = varianceRounded > 0 ? `+${varianceRounded} pts` : `${varianceRounded} pts`;
      rows.appendChild(el('div', { class: 'filter-row', style: 'justify-content: space-between; align-items: center;' }, [
        el('div', { class: 'category-meta' }, [
          el('span', { class: 'dot', style: `background:${item.color || '#3b82f6'}` }),
          el('span', { class: 'category-name' }, [item.name]),
          el('span', { class: 'transaction-sub' }, [`cible ${target}%`])
        ]),
        el('div', { class: 'category-meta' }, [
          el('span', {}, [`${actual}% (${formatCents(item.amountCents)})`]),
          el('span', { class: `chip ${varianceClass}` }, [varianceLabel])
        ])
      ]));
    }
    budgetTypePanel.appendChild(rows);
  }

  async function renderTransactionsPanel() {
    transactionsPanel.innerHTML = '';
    transactionsPanel.appendChild(el('div', { class: 'panel-header' }, [el('h2', {}, ['Transactions'])]));
    let rows = [];
    try {
      rows = await api.get('/api/transactions', {
        query: {
          startMonth: filterState.startMonth,
          endMonth: filterState.endMonth,
          cashflowId: filterState.cashflowId,
          categoryId: '',
          status: 'ACTIVE',
          limit: 100
        }
      });
    } catch (err) {
      toast(err.message, { type: 'error' });
      return;
    }

    if (rows.length === 0) {
      transactionsPanel.appendChild(el('p', { class: 'empty-state' }, ['Aucune transaction sur ce filtre.']));
      return;
    }

    const list = el('div', { class: 'transaction-list' });
    for (const t of rows) {
      list.appendChild(renderTransactionRow(t, {
        categories, subcategoriesByCategory, categoryById, budgetTypeById, accountById, cashflows, onChange: load
      }));
    }
    transactionsPanel.appendChild(list);
    transactionsPanel.appendChild(el('div', { class: 'filter-row panel-separator' }, [
      el('a', {
        href: `#/transactions?startMonth=${filterState.startMonth}&endMonth=${filterState.endMonth}`,
        class: 'ghost-button'
      }, ['Voir toutes les transactions →'])
    ]));
  }

  async function load() {
    buildFilters();
    let data;
    let budgetTypeData;
    try {
      [data, budgetTypeData] = await Promise.all([
        api.get('/api/dashboard/summary', {
          query: {
            startMonth: filterState.startMonth,
            endMonth: filterState.endMonth,
            cashflowId: filterState.cashflowId
          }
        }),
        api.get('/api/dashboard/budget-types', {
          query: {
            startMonth: filterState.startMonth,
            endMonth: filterState.endMonth,
            cashflowId: filterState.cashflowId
          }
        })
      ]);
    } catch (err) {
      toast(err.message, { type: 'error' });
      return;
    }

    renderBudgetTypePanel(budgetTypeData);

    summaryGrid.innerHTML = '';
    summaryGrid.appendChild(el('div', { class: 'metric-card income' }, [
      el('span', { class: 'label' }, ['Revenus']),
      el('strong', {}, [formatCents(data.totals.revenueCents)])
    ]));
    summaryGrid.appendChild(el('div', { class: 'metric-card expense' }, [
      el('span', { class: 'label' }, ['Dépenses']),
      el('strong', {}, [formatCents(data.totals.expenseCents)])
    ]));
    summaryGrid.appendChild(el('div', { class: 'metric-card balance' }, [
      el('span', { class: 'label' }, ['Restant']),
      el('strong', {}, [formatCents(data.totals.remainingCents)])
    ]));

    let revenueNodes = data.revenue;
    let expenseNodes = data.expense;

    const container = document.getElementById('sankey-container');
    renderSankey(container, { revenue: revenueNodes, expense: expenseNodes }, {
      formatValue: (v) => formatCents(v),
      onNodeClick: (ref) => {
        const params = new URLSearchParams({ startMonth: filterState.startMonth, endMonth: filterState.endMonth });
        if (ref.categoryId) params.set('categoryId', ref.categoryId);
        window.location.hash = `#/transactions?${params.toString()}`;
      }
    });

    await renderTransactionsPanel();
  }

  await load();
  window.addEventListener('resize', () => load(), { once: false });
}

export { renderDashboard };
