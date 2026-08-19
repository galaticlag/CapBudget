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

const SANKEY_DETAIL_LEVELS = [
  { value: 'SUMMARY', label: 'Résumé' },
  { value: 'BALANCED', label: 'Équilibré' },
  { value: 'DETAILED', label: 'Détaillé' }
];

function monthSpanInclusive(startMonth, endMonth) {
  if (!startMonth || !endMonth) return 1;
  const [sy, sm] = String(startMonth).split('-').map((v) => Number(v));
  const [ey, em] = String(endMonth).split('-').map((v) => Number(v));
  if (!sy || !sm || !ey || !em) return 1;
  const span = (ey - sy) * 12 + (em - sm) + 1;
  return span > 0 ? span : 1;
}

function shiftMonthStr(monthStr, deltaMonths) {
  const [y, m] = String(monthStr || '').split('-').map((v) => Number(v));
  if (!y || !m) return monthStr;
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + deltaMonths);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function divideDashboardSummary(summary, divisor) {
  if (!summary || !Number.isFinite(divisor) || divisor <= 1) return summary;
  const div = (v) => Math.round((Number(v) || 0) / divisor);
  const mapNodes = (nodes) => (nodes || []).map((c) => ({
    ...c,
    amountCents: div(c.amountCents),
    subcategories: (c.subcategories || []).map((s) => ({ ...s, amountCents: div(s.amountCents) }))
  }));

  return {
    ...summary,
    totals: {
      revenueCents: div(summary.totals?.revenueCents),
      expenseCents: div(summary.totals?.expenseCents),
      remainingCents: div(summary.totals?.remainingCents)
    },
    revenue: mapNodes(summary.revenue),
    expense: mapNodes(summary.expense)
  };
}

function divideBudgetTypeSummary(budgetTypeData, divisor) {
  if (!budgetTypeData || !Number.isFinite(divisor) || divisor <= 1) return budgetTypeData;
  const div = (v) => Math.round((Number(v) || 0) / divisor);
  return {
    ...budgetTypeData,
    totalExpenseCents: div(budgetTypeData.totalExpenseCents),
    unassignedCents: div(budgetTypeData.unassignedCents),
    items: (budgetTypeData.items || []).map((i) => ({ ...i, amountCents: div(i.amountCents) }))
  };
}

function percentLabel(partCents, totalCents) {
  const total = Number(totalCents) || 0;
  const part = Number(partCents) || 0;
  if (total <= 0) return '***';
  const pct = (part / total) * 100;
  if (!Number.isFinite(pct)) return '***';
  // A nonzero share under 1% would otherwise round down to a misleading 0%.
  if (pct > 0 && Math.round(pct) === 0) return `${pct.toFixed(2)}%`;
  return `${Math.round(pct)}%`;
}

// "Restant" has no natural 100% base of its own (revenue and expense are almost
// never balanced) — shown instead as the surplus/deficit vs. revenue (savings rate).
function remainingPercentLabel(remainingCents, revenueCents) {
  const revenue = Number(revenueCents) || 0;
  if (revenue <= 0) return '***';
  const pct = (Number(remainingCents) || 0) / revenue * 100;
  if (!Number.isFinite(pct)) return '***';
  // A nonzero share under 1% would otherwise round down to a misleading 0%.
  if (pct !== 0 && Math.round(Math.abs(pct)) === 0) return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
  const rounded = Math.round(pct);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

async function renderDashboard(root, { user } = {}) {
  root.innerHTML = '';

  // The persisted default (from user preferences) vs. the level actually applied
  // right now — they only diverge for the current session, until the user
  // explicitly clicks "Définir par défaut" (see the banner below).
  let persistedDetailLevel = user?.sankeyDetailLevel || 'BALANCED';
  const filterState = {
    startMonth: currentMonthStr(),
    endMonth: currentMonthStr(),
    cashflowId: '',
    activeShortcut: 1,
    monthlyView: false,
    hideAmounts: Boolean(window.__capbudgetHideAmounts),
    sankeyDetailLevel: persistedDetailLevel,
    sankeyFilter: null // { categoryId?, subcategoryId?, label } set by clicking the sankey
  };

  const filtersBar = el('div', { class: 'panel', id: 'dash-filters' });
  const summaryGrid = el('div', { class: 'summary-stack', id: 'dash-summary' });
  const summaryPanel = el('div', { class: 'panel summary-panel' }, [summaryGrid]);
  const budgetTypePanel = el('div', { class: 'panel', id: 'dash-budget-types' });
  const summaryBudgetGrid = el('div', { class: 'summary-budget-grid' }, [summaryPanel, budgetTypePanel]);
  const detailLevelRow = el('div', { class: 'sankey-detail-level-row' });
  const sankeyDefaultBanner = el('div', { class: 'info-box', style: 'display: none;' });
  const sankeyPanelTitle = el('div', { class: 'panel-header' }, [
    el('h2', {}, ['Flux du foyer']),
    detailLevelRow
  ]);

  function renderDetailLevelRow() {
    detailLevelRow.innerHTML = '';
    detailLevelRow.appendChild(el('span', { class: 'field-mini-label' }, ['Niveau de détail']));
    for (const level of SANKEY_DETAIL_LEVELS) {
      const isDefault = persistedDetailLevel === level.value;
      detailLevelRow.appendChild(el('button', {
        class: `chip ${filterState.sankeyDetailLevel === level.value ? 'chip-active' : ''}`,
        onclick: () => {
          if (filterState.sankeyDetailLevel === level.value) return;
          filterState.sankeyDetailLevel = level.value;
          render();
        }
      }, [isDefault ? `${level.label} • Défaut` : level.label]));
    }
  }

  function renderDefaultBanner() {
    if (filterState.sankeyDetailLevel === persistedDetailLevel) {
      sankeyDefaultBanner.style.display = 'none';
      sankeyDefaultBanner.innerHTML = '';
      return;
    }
    const levelLabel = SANKEY_DETAIL_LEVELS.find((l) => l.value === filterState.sankeyDetailLevel)?.label || filterState.sankeyDetailLevel;
    sankeyDefaultBanner.style.display = '';
    sankeyDefaultBanner.innerHTML = '';
    sankeyDefaultBanner.appendChild(el('span', {}, [`Vue « ${levelLabel} » appliquée pour cette session.`]));
    sankeyDefaultBanner.appendChild(el('button', {
      class: 'ghost-button',
      onclick: async () => {
        try {
          await api.put('/api/me/sankey-detail-level', { sankeyDetailLevel: filterState.sankeyDetailLevel });
          persistedDetailLevel = filterState.sankeyDetailLevel;
          if (user) user.sankeyDetailLevel = persistedDetailLevel;
          toast(`✓ ${levelLabel} est maintenant votre vue par défaut.`, { type: 'success' });
          render();
        } catch (err) { toast(err.message, { type: 'error' }); }
      }
    }, ['Définir par défaut']));
  }

  // A single re-render helper for the level chips + banner so every place that
  // changes filterState.sankeyDetailLevel (chip click, "set as default") stays
  // in sync without duplicating the two render calls + load().
  async function render() {
    renderDetailLevelRow();
    renderDefaultBanner();
    await load();
  }

  const sankeyPanel = el('div', { class: 'panel sankey-panel' }, [
    sankeyPanelTitle,
    sankeyDefaultBanner,
    el('div', { class: 'sankey-container', id: 'sankey-container' })
  ]);
  const transactionsPanel = el('div', { class: 'panel', id: 'dash-transactions' });

  root.appendChild(el('div', { class: 'dashboard' }, [filtersBar, summaryBudgetGrid, sankeyPanel, transactionsPanel]));

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
    const monthsSelected = monthSpanInclusive(filterState.startMonth, filterState.endMonth);

    const monthLabelFr = (monthStr) => {
      const [y, m] = String(monthStr || '').split('-').map((v) => Number(v));
      if (!y || !m) return monthStr;
      const d = new Date(Date.UTC(y, m - 1, 1));
      return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(d);
    };

    const periodSummaryLabel = () => {
      const start = monthLabelFr(filterState.startMonth);
      const end = monthLabelFr(filterState.endMonth);
      const span = monthSpanInclusive(filterState.startMonth, filterState.endMonth);
      if (span <= 1) return `Période sélectionnée : ${start}`;
      return `Période sélectionnée : ${start} à ${end} · ${span} mois`;
    };

    const shortcutRow = el('div', { class: 'filter-row period-shortcuts-row' }, [
      el('div', { class: 'filter-row-chips' }, [
        el('span', { class: 'filter-group-label period-inline-label' }, ['Période']),
        ...MONTH_SHORTCUTS.map((s) => el('button', {
          class: `chip ${filterState.activeShortcut === s.months ? 'chip-active' : ''}`,
          onclick: () => {
            filterState.activeShortcut = s.months;
            filterState.startMonth = currentMonthStr(-(s.months - 1));
            filterState.endMonth = currentMonthStr();
            filterState.sankeyFilter = null;
            load();
          }
        }, [s.label]))
      ]),
      el('div', { class: 'period-cashflow' }, [
        el('label', { class: 'field-mini-label' }, ['Type de cashflow']),
        el('select', {
          onchange: (e) => { filterState.cashflowId = e.target.value; filterState.sankeyFilter = null; load(); }
        }, [
          el('option', { value: '', selected: filterState.cashflowId === '' ? 'selected' : undefined }, ['Tous les cashflows']),
          ...cashflows.map((c) => el('option', {
            value: c.id,
            selected: String(filterState.cashflowId) === String(c.id) ? 'selected' : undefined
          }, [c.name]))
        ])
      ])
    ]);

    const navRow = el('div', { class: 'filter-row period-nav-row' }, [
      el('button', {
        class: 'ghost-button nav-arrow',
        title: 'Décaler la période vers le passé',
        'aria-label': 'Décaler la période vers le passé',
        onclick: () => {
          const span = monthSpanInclusive(filterState.startMonth, filterState.endMonth);
          filterState.activeShortcut = null;
          filterState.startMonth = shiftMonthStr(filterState.startMonth, -1);
          filterState.endMonth = shiftMonthStr(filterState.endMonth, -1);
          if (monthSpanInclusive(filterState.startMonth, filterState.endMonth) !== span) {
            filterState.endMonth = shiftMonthStr(filterState.startMonth, span - 1);
          }
          filterState.sankeyFilter = null;
          load();
        }
      }, ['←']),
      el('div', { class: 'period-months' }, [
        el('label', { class: 'period-month-button', title: 'Mois de début' }, [
          el('span', {}, [monthLabelFr(filterState.startMonth)]),
          el('span', { class: 'calendar-icon' }, ['📅']),
          el('input', {
            class: 'period-month-input',
            type: 'month',
            value: filterState.startMonth,
            onchange: (e) => { filterState.activeShortcut = null; filterState.startMonth = e.target.value; filterState.sankeyFilter = null; load(); }
          })
        ]),
        el('span', { class: 'period-arrow' }, ['→']),
        el('label', { class: 'period-month-button', title: 'Mois de fin' }, [
          el('span', {}, [monthLabelFr(filterState.endMonth)]),
          el('span', { class: 'calendar-icon' }, ['📅']),
          el('input', {
            class: 'period-month-input',
            type: 'month',
            value: filterState.endMonth,
            onchange: (e) => { filterState.activeShortcut = null; filterState.endMonth = e.target.value; filterState.sankeyFilter = null; load(); }
          })
        ])
      ]),
      el('button', {
        class: 'ghost-button nav-arrow',
        title: 'Décaler la période vers le futur',
        'aria-label': 'Décaler la période vers le futur',
        onclick: () => {
          const span = monthSpanInclusive(filterState.startMonth, filterState.endMonth);
          filterState.activeShortcut = null;
          filterState.startMonth = shiftMonthStr(filterState.startMonth, 1);
          filterState.endMonth = shiftMonthStr(filterState.endMonth, 1);
          if (monthSpanInclusive(filterState.startMonth, filterState.endMonth) !== span) {
            filterState.endMonth = shiftMonthStr(filterState.startMonth, span - 1);
          }
          filterState.sankeyFilter = null;
          load();
        }
      }, ['→'])
    ]);

    const monthlyAllowed = monthsSelected > 1;
    if (!monthlyAllowed && filterState.monthlyView) filterState.monthlyView = false;

    // Single-month case is already obvious from the pill above — only spell out
    // the range as text when a multi-month span needs the extra clarity.
    const periodSummary = !monthlyAllowed ? null : el('div', { class: 'transaction-sub period-summary' }, [periodSummaryLabel()]);

    const monthlyRow = !monthlyAllowed ? null : el('div', { class: 'filter-row monthly-row' }, [
      el('div', { class: 'monthly-left' }, [
        el('span', {}, ['Afficher une moyenne mensuelle']),
        el('span', { class: 'tooltip' }, [
          el('button', {
            class: 'info-icon',
            type: 'button',
            'aria-label': 'Informations',
            onclick: (e) => {
              e.preventDefault();
              e.stopPropagation();
              const tip = e.currentTarget.closest('.tooltip');
              tip?.classList.toggle('open');
            }
          }, ['i']),
          el('span', { class: 'tooltip-content' }, [`Les montants sont divisés par ${monthsSelected} mois pour faciliter la comparaison.`])
        ])
      ]),
      el('button', {
        type: 'button',
        class: `toggle-chip ${filterState.monthlyView ? 'active' : ''}`,
        onclick: () => { filterState.monthlyView = !filterState.monthlyView; load(); }
      }, [
        el('span', { class: 'toggle-pill', 'aria-hidden': 'true' }),
        el('span', { class: 'toggle-text' }, [filterState.monthlyView ? 'ON' : 'OFF'])
      ])
    ]);

    const stack = el('div', { class: 'stack-form' }, [
      shortcutRow,
      navRow,
      periodSummary,
      monthlyRow
    ].filter(Boolean));

    // Close tooltip when clicking elsewhere in the filters.
    stack.addEventListener('click', (e) => {
      const openTip = stack.querySelector('.tooltip.open');
      if (!openTip) return;
      if (e.target.closest('.tooltip')) return;
      openTip.classList.remove('open');
    });

    filtersBar.appendChild(stack);
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
      const rightLabel = filterState.hideAmounts
        ? `${Math.round(actual)}%`
        : `${actual}% (${formatCents(item.amountCents)})`;
      rows.appendChild(el('div', { class: 'filter-row', style: 'justify-content: space-between; align-items: center;' }, [
        el('div', { class: 'category-meta' }, [
          el('span', { class: 'dot', style: `background:${item.color || '#3b82f6'}` }),
          el('span', { class: 'category-name' }, [item.name]),
          el('span', { class: 'transaction-sub' }, [`cible ${target}%`])
        ]),
        el('div', { class: 'category-meta' }, [
          el('span', {}, [rightLabel]),
          el('span', { class: `chip ${varianceClass}` }, [varianceLabel])
        ])
      ]));
    }
    budgetTypePanel.appendChild(rows);
  }

  async function renderTransactionsPanel() {
    transactionsPanel.innerHTML = '';
    const header = el('div', { class: 'panel-header' }, [el('h2', {}, ['Transactions'])]);
    if (filterState.sankeyFilter) {
      header.appendChild(el('span', { class: 'chip chip-active' }, [
        `Filtre : ${filterState.sankeyFilter.label} `,
        el('button', {
          class: 'ghost-button',
          style: 'margin-left: 4px; padding: 0 6px;',
          title: 'Retirer le filtre',
          onclick: () => { filterState.sankeyFilter = null; renderTransactionsPanel(); }
        }, ['×'])
      ]));
    }
    transactionsPanel.appendChild(header);
    let rows = [];
    try {
      rows = await api.get('/api/transactions', {
        query: {
          startMonth: filterState.startMonth,
          endMonth: filterState.endMonth,
          cashflowId: filterState.cashflowId,
          categoryId: filterState.sankeyFilter?.categoryId || '',
          subcategoryId: filterState.sankeyFilter?.subcategoryId || '',
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

    // Sync with the topbar eye toggle.
    filterState.hideAmounts = Boolean(window.__capbudgetHideAmounts);

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

    const monthsSelected = monthSpanInclusive(filterState.startMonth, filterState.endMonth);
    const divisor = filterState.monthlyView ? monthsSelected : 1;
    data = divideDashboardSummary(data, divisor);
    budgetTypeData = divideBudgetTypeSummary(budgetTypeData, divisor);

    renderBudgetTypePanel(budgetTypeData);

    summaryGrid.innerHTML = '';
    const summaryTotalAbsCents = Math.max(
      Math.abs(Number(data.totals.revenueCents) || 0),
      Math.abs(Number(data.totals.expenseCents) || 0)
    );

    summaryGrid.appendChild(el('div', { class: 'metric-card income' }, [
      el('span', { class: 'label' }, ['Revenus']),
      el('strong', {}, [filterState.hideAmounts ? '***' : formatCents(data.totals.revenueCents)])
    ]));
    summaryGrid.appendChild(el('div', { class: 'metric-card expense' }, [
      el('span', { class: 'label' }, ['Dépenses']),
      el('strong', {}, [filterState.hideAmounts ? '***' : formatCents(data.totals.expenseCents)])
    ]));
    summaryGrid.appendChild(el('div', { class: 'metric-card balance' }, [
      el('span', { class: 'label' }, ['Restant']),
      el('strong', {}, [filterState.hideAmounts
        ? remainingPercentLabel(data.totals.remainingCents, data.totals.revenueCents)
        : formatCents(data.totals.remainingCents)])
    ]));

    // Summary: no subcategories on either side (revenue = category level). Balanced
    // (default): revenue shows subcategory level instead (each subcategory becomes
    // its own top-level node linked straight to the center, replacing its parent
    // category rather than nesting under it), expense keeps full category+subcategory
    // detail unchanged. Detailed: both sides show full category+subcategory nesting.
    const stripSubcategories = (nodes) => nodes.map((n) => ({ ...n, subcategories: [] }));
    const promoteSubcategories = (nodes) => nodes.flatMap((cat) => {
      const subs = (cat.subcategories || []).filter((s) => s.amountCents > 0);
      if (subs.length === 0) return [{ ...cat, subcategories: [] }];
      return subs.map((sub) => ({
        categoryId: cat.categoryId,
        subcategoryId: sub.subcategoryId,
        name: sub.name,
        amountCents: sub.amountCents,
        color: sub.color || null,
        subcategories: []
      }));
    });
    let revenueNodes = data.revenue;
    let expenseNodes = data.expense;
    if (filterState.sankeyDetailLevel === 'SUMMARY') revenueNodes = stripSubcategories(revenueNodes);
    else if (filterState.sankeyDetailLevel === 'BALANCED') revenueNodes = promoteSubcategories(revenueNodes);
    if (filterState.sankeyDetailLevel === 'SUMMARY') expenseNodes = stripSubcategories(expenseNodes);

    const container = document.getElementById('sankey-container');
    renderSankey(container, { revenue: revenueNodes, expense: expenseNodes }, {
      formatValue: (v, side) => {
        if (!filterState.hideAmounts) return formatCents(v);
        // Privacy mode: revenue's own sum is its 100% base, expense's own sum is its
        // 100% base (kept separate — the two are rarely perfectly balanced).
        const sideTotal = side === 'EXPENSE' ? data.totals.expenseCents : data.totals.revenueCents;
        return percentLabel(v, sideTotal);
      },
      onNodeClick: (ref) => {
        // Filters the transaction list below without touching/re-rendering the sankey itself.
        if (ref.subcategoryId) {
          const sub = subcategoriesByCategory.get(ref.categoryId)?.find((s) => s.id === ref.subcategoryId);
          filterState.sankeyFilter = { subcategoryId: ref.subcategoryId, label: sub ? sub.name : 'Sous-catégorie' };
        } else if (ref.categoryId) {
          const cat = categoryById.get(ref.categoryId);
          filterState.sankeyFilter = { categoryId: ref.categoryId, label: cat ? cat.name : 'Catégorie' };
        } else {
          filterState.sankeyFilter = null;
        }
        renderTransactionsPanel();
      }
    });

    await renderTransactionsPanel();
  }

  await render();
  window.addEventListener('resize', () => load(), { once: false });

  // React to global eye toggle changes (topbar).
  const onHideAmountsChanged = (e) => {
    filterState.hideAmounts = Boolean(e?.detail?.hideAmounts);
    load();
  };
  window.addEventListener('capbudget:hide-amounts-changed', onHideAmountsChanged);
}

export { renderDashboard };
