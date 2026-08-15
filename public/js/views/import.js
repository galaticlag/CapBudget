'use strict';

import { api } from '../api.js';
import { el, formatCents, formatDate } from '../util.js';
import { toast } from '../toast.js';

const FIELD_LABELS = {
  operation_date: "Date d'opération *",
  value_date: 'Date de valeur',
  label: 'Libellé *',
  suggested_label: 'Libellé suggéré',
  amount: 'Montant *',
  account_reference: 'Référence compte',
  account_label: 'Nom du compte',
  balance: 'Solde',
  comment: 'Commentaire',
  source_category: 'Catégorie (optionnel)',
  source_subcategory: 'Sous-catégorie (optionnel)'
};

async function renderImport(root) {
  root.innerHTML = '';
  let csvText = null;
  let filename = '';
  let headers = [];
  let mapping = {};
  let previewResult = null;

  const uploadPanel = el('div', { class: 'panel' });
  const previewPanel = el('div', { class: 'panel hidden' });
  root.appendChild(el('div', { class: 'dashboard' }, [uploadPanel, previewPanel]));

  uploadPanel.appendChild(el('div', { class: 'panel-header' }, [el('h2', {}, ['1. Sélectionner un fichier CSV'])]));
  const fileInput = el('input', { type: 'file', accept: '.csv,text/csv' });
  uploadPanel.appendChild(el('div', { class: 'stack-form' }, [fileInput]));

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    filename = file.name;
    csvText = await file.text();
    await runPreview();
  });

  async function runPreview() {
    try {
      previewResult = await api.post('/api/import/preview', { csvText, filename, mapping });
    } catch (err) {
      toast(err.message, { type: 'error' });
      return;
    }
    if (previewResult.error) {
      toast(previewResult.error, { type: 'error' });
    }
    headers = previewResult.headers || [];
    mapping = previewResult.mapping || mapping;
    renderPreview();
  }

  function renderPreview() {
    previewPanel.classList.remove('hidden');
    previewPanel.innerHTML = '';
    previewPanel.appendChild(el('div', { class: 'panel-header' }, [el('h2', {}, ['2. Vérifier le mapping des colonnes'])]));

    const mappingForm = el('div', { class: 'filter-row' }, Object.entries(FIELD_LABELS).map(([field, label]) =>
      el('label', { class: 'mapping-field' }, [
        label,
        el('select', {
          onchange: (e) => {
            const idx = Number(e.target.value);
            mapping[field] = idx >= 0 ? headers[idx] : null;
            runPreview();
          }
        }, [
          el('option', { value: '-1' }, ['— Non mappé —']),
          ...headers.map((h, i) => el('option', {
            value: String(i),
            selected: mapping[field] === h ? 'selected' : undefined
          }, [h]))
        ])
      ])
    ));
    previewPanel.appendChild(mappingForm);

    const s = previewResult.summary || {};
    previewPanel.appendChild(el('div', { class: 'filter-row panel-separator' }, [
      el('span', { class: 'chip' }, [`Total : ${s.total ?? 0}`]),
      el('span', { class: 'chip chip-success' }, [`Valides : ${s.valid ?? 0}`]),
      el('span', { class: 'chip chip-warning' }, [`Doublons potentiels : ${s.potentialDuplicate ?? 0}`]),
      el('span', { class: 'chip' }, [`Doublons exacts : ${s.duplicate ?? 0}`]),
      el('span', { class: 'chip chip-danger' }, [`Erreurs : ${s.error ?? 0}`])
    ]));

    const rows = (previewResult.rows || []).slice(0, 30);
    const list = el('div', { class: 'transaction-list panel-separator' });
    for (const row of rows) {
      const statusClass = { IMPORTED: 'chip-success', DUPLICATE: '', POTENTIAL_DUPLICATE: 'chip-warning', ERROR: 'chip-danger' }[row.status] || '';
      list.appendChild(el('div', { class: 'transaction-row' }, [
        el('div', { class: 'transaction-main' }, [
          el('span', { class: 'transaction-label' }, [row.label || `Ligne ${row.rowNumber}`]),
          el('span', { class: 'transaction-sub' }, [row.errors && row.errors.length ? row.errors.join(' ') : formatDate(row.operationDate)])
        ]),
        el('span', { class: `chip ${statusClass}` }, [row.status]),
        row.categorization ? el('span', { class: `chip ${row.categorization.willCreateCategory || row.categorization.willCreateSubcategory ? 'chip-warning' : ''}` }, [
          [row.categorization.categoryName, row.categorization.subcategoryName].filter(Boolean).join(' / ') +
            (row.categorization.willCreateCategory || row.categorization.willCreateSubcategory ? ' (nouvelle)' : '')
        ]) : el('span', {}),
        row.amountCents !== undefined ? el('span', { class: 'transaction-amount' }, [formatCents(row.amountCents)]) : el('span', {})
      ]));
    }
    previewPanel.appendChild(list);

    const canCommit = (s.valid ?? 0) + (s.potentialDuplicate ?? 0) > 0 && !previewResult.error;
    previewPanel.appendChild(el('div', { class: 'panel-separator' }, [
      el('button', {
        class: 'primary-button',
        disabled: canCommit ? undefined : 'disabled',
        onclick: async () => {
          try {
            const result = await api.post('/api/import/commit', { csvText, filename, mapping });
            toast(`Import terminé : ${result.createdCount} créées, ${result.duplicateCount} doublons ignorés.`, { type: 'success' });
            previewPanel.appendChild(el('p', { class: 'empty-state panel-separator' }, [
              `Lot ${result.batchId} : ${result.createdCount} créées, ${result.potentialDuplicateCount} à vérifier, ${result.duplicateCount} doublons, ${result.errorCount} erreurs.`
            ]));
          } catch (err) {
            toast(err.message, { type: 'error' });
          }
        }
      }, ['3. Confirmer l\u2019import'])
    ]));
  }
}

export { renderImport };
