'use strict';

import { api } from '../api.js';
import { el } from '../util.js';
import { toast } from '../toast.js';

async function renderAudit(root) {
  root.innerHTML = '';
  const panel = el('div', { class: 'panel' });
  root.appendChild(el('div', { class: 'dashboard' }, [panel]));

  let rows = [];
  try {
    rows = await api.get('/api/audit/household');
  } catch (err) {
    toast(err.message, { type: 'error' });
  }

  panel.appendChild(el('div', { class: 'panel-header' }, [el('h2', {}, ['Journal du foyer'])]));
  if (rows.length === 0) {
    panel.appendChild(el('p', { class: 'empty-state' }, ['Aucune action enregistrée.']));
    return;
  }
  const list = el('div', { class: 'transaction-list' });
  for (const r of rows) {
    list.appendChild(el('div', { class: 'transaction-row' }, [
      el('div', { class: 'transaction-main' }, [
        el('span', { class: 'transaction-label' }, [`${r.action} · ${r.entity_type}`]),
        el('span', { class: 'transaction-sub' }, [new Date(r.created_at).toLocaleString('fr-FR')])
      ])
    ]));
  }
  panel.appendChild(list);
}

export { renderAudit };
