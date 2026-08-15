'use strict';

import { api } from '../api.js';
import { el, formatCents, formatDate, escapeHtml } from '../util.js';
import { toast } from '../toast.js';

async function renderToVerify(root) {
  root.innerHTML = '';
  const panel = el('div', { class: 'panel' });
  root.appendChild(el('div', { class: 'dashboard' }, [panel]));

  async function load() {
    let data;
    try {
      data = await api.get('/api/transactions/to-verify');
    } catch (err) {
      toast(err.message, { type: 'error' });
      return;
    }

    panel.innerHTML = '';
    panel.appendChild(el('div', { class: 'panel-header' }, [el('h2', {}, ['À vérifier'])]));

    const tabs = [
      { key: 'uncategorized', label: 'Non catégorisées', data: data.uncategorized },
      { key: 'potentialDuplicates', label: 'Doublons potentiels', data: data.potentialDuplicates },
      { key: 'importErrors', label: "Erreurs d'import", data: data.importErrors, isRaw: true }
    ];

    panel.appendChild(el('div', { class: 'filter-row' }, tabs.map((t) => el('span', { class: 'chip' }, [`${t.label} : ${t.data.count}`]))));

    for (const tab of tabs) {
      if (tab.data.count === 0) continue;
      const section = el('div', { class: 'panel-separator' }, [el('h3', {}, [tab.label])]);
      const list = el('div', { class: 'transaction-list' });
      for (const item of tab.data.items.slice(0, 100)) {
        if (tab.isRaw) {
          list.appendChild(el('div', { class: 'transaction-row' }, [
            el('div', { class: 'transaction-main' }, [
              el('span', { class: 'transaction-label' }, [`Ligne ${item.row_number}`]),
              el('span', { class: 'transaction-sub' }, [escapeHtml(item.error_message || '')])
            ])
          ]));
          continue;
        }
        const row = el('div', { class: 'transaction-row' }, [
          el('div', { class: 'transaction-main' }, [
            el('span', { class: 'transaction-label' }, [escapeHtml(item.raw_label)]),
            el('span', { class: 'transaction-sub' }, [formatDate(item.operation_date)])
          ]),
          el('span', { class: `transaction-amount ${item.amount_cents < 0 ? 'amount-expense' : 'amount-income'}` }, [formatCents(item.amount_cents)])
        ]);
        list.appendChild(row);
      }
      section.appendChild(list);
      panel.appendChild(section);
    }

    if (tabs.every((t) => t.data.count === 0)) {
      panel.appendChild(el('p', { class: 'empty-state' }, ['Rien à vérifier, tout est en ordre ✨']));
    }
  }

  await load();
}

export { renderToVerify };
