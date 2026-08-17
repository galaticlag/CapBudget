'use strict';

import { api, getToken, setToken, getHouseholdId, setHouseholdId, setUnauthorizedHandler } from './api.js';
import { initTheme, setTheme } from './theme.js';
import { el } from './util.js';
import { toast } from './toast.js';
import { renderSetup, renderLogin } from './views/auth.js';
import { renderAdmin } from './views/admin.js';
import { renderDashboard } from './views/dashboard.js';
import { renderTransactions } from './views/transactions.js';
import { renderToVerify } from './views/toVerify.js';
import { renderImport } from './views/import.js';
import { renderRules } from './views/rules.js';
import { renderReferentials } from './views/referentials.js';
import { renderAudit } from './views/audit.js';
import { renderSettings } from './views/settings.js';

const appRoot = document.getElementById('app-root');

const MEMBER_NAV = [
  { path: 'dashboard', label: 'Tableau de bord', render: renderDashboard },
  { path: 'transactions', label: 'Transactions', render: renderTransactions },
  { path: 'to-verify', label: 'À vérifier', render: renderToVerify },
  { path: 'import', label: 'Import CSV', render: renderImport },
  { path: 'rules', label: 'Règles', render: renderRules },
  { path: 'referentials', label: 'Référentiel', render: renderReferentials },
  { path: 'audit', label: 'Journal', render: renderAudit },
  { path: 'settings', label: 'Paramètres', render: (root, ctx) => renderSettings(root, ctx.user) }
];

let currentUser = null;
let currentHouseholds = [];
let navDropdownEl = null;

// Dashboard global UI state (per session). Views can read it and react to events.
window.__capbudgetHideAmounts = false;

// Single global listener (registered once) closes whichever nav dropdown is currently open.
document.addEventListener('click', (event) => {
  if (navDropdownEl && !navDropdownEl.contains(event.target)) {
    navDropdownEl.classList.remove('nav-dropdown-open');
  }
});

function currentRoute() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const [path] = hash.split('?');
  return path || '';
}

async function boot() {
  initTheme();
  setUnauthorizedHandler(() => {
    currentUser = null;
    renderShellForRoute();
  });

  if (!getToken()) {
    await routeUnauthenticated();
    return;
  }

  try {
    currentUser = await api.get('/api/me');
  } catch {
    setToken(null);
    await routeUnauthenticated();
    return;
  }
  setTheme(currentUser.themePreference || 'SYSTEM');
  currentHouseholds = currentUser.households || [];
  if (currentUser.role === 'MEMBER' && currentHouseholds.length > 0 && !getHouseholdId()) {
    setHouseholdId(currentHouseholds[0].id);
  }
  renderShellForRoute();
}

async function routeUnauthenticated() {
  let status;
  try {
    status = await api.get('/api/setup/status');
  } catch (err) {
    toast(err.message, { type: 'error' });
    status = { needsSetup: false };
  }
  if (status.needsSetup) {
    await renderSetup(appRoot, { onDone: () => routeUnauthenticated() });
  } else {
    await renderLogin(appRoot, { onDone: (user) => { currentUser = user; boot(); } });
  }
}

function buildTopbar() {
  const isAdmin = currentUser.role === 'ADMIN';
  const navItems = isAdmin ? [{ path: 'admin', label: 'Console admin' }, { path: 'settings', label: 'Paramètres' }] : MEMBER_NAV;

  const navPanel = el('div', { class: 'nav-dropdown-panel' }, navItems.map((item) =>
    el('a', {
      href: `#/${item.path}`,
      class: currentRoute() === item.path ? 'nav-link nav-link-active' : 'nav-link',
      onclick: () => { navWrapper.classList.remove('nav-dropdown-open'); }
    }, [item.label])
  ));
  const navToggle = el('button', {
    class: 'ghost-button nav-dropdown-toggle',
    type: 'button',
    onclick: (e) => { e.stopPropagation(); navWrapper.classList.toggle('nav-dropdown-open'); }
  }, ['☰ Menu']);
  const navWrapper = el('div', { class: 'nav-dropdown' }, [navToggle, navPanel]);
  navDropdownEl = navWrapper;

  const householdSwitcher = !isAdmin && currentHouseholds.length > 1
    ? el('select', {
      onchange: (e) => { setHouseholdId(e.target.value); renderShellForRoute(); }
    }, currentHouseholds.map((h) => el('option', { value: h.id, selected: h.id === getHouseholdId() ? 'selected' : undefined }, [h.name])))
    : null;

  const currentHousehold = currentHouseholds.find((h) => h.id === getHouseholdId());
  const titleText = isAdmin ? 'Console administrateur' : (currentHousehold?.name || 'Foyer');
  const titleRow = el('div', { class: 'topbar-title-row' }, [el('h1', {}, [titleText])]);

  if (!isAdmin && currentHousehold) {
    titleRow.appendChild(el('button', {
      class: 'icon-button',
      type: 'button',
      title: 'Renommer le foyer',
      onclick: () => startEditingHouseholdName(titleRow, currentHousehold)
    }, ['✏️']));
  }

  const dashboardEye = (!isAdmin)
    ? el('button', {
      class: 'ghost-button topbar-eye-toggle',
      type: 'button',
      title: 'Masquer / afficher les montants',
      onclick: () => {
        window.__capbudgetHideAmounts = !window.__capbudgetHideAmounts;
        dashboardEye.replaceChildren(document.createTextNode(window.__capbudgetHideAmounts ? '🙈' : '👁️'));
        window.dispatchEvent(new CustomEvent('capbudget:hide-amounts-changed', {
          detail: { hideAmounts: window.__capbudgetHideAmounts }
        }));
      }
    }, [window.__capbudgetHideAmounts ? '🙈' : '👁️'])
    : null;

  return el('div', { class: 'topbar' }, [
    el('div', { class: 'topbar-branding' }, [
      el('p', { class: 'eyebrow' }, ['CapBudget']),
      titleRow
    ]),
    el('div', { class: 'topbar-right' }, [
      householdSwitcher,
      dashboardEye,
      navWrapper,
      el('span', { class: 'user-chip' }, [`👤 ${currentUser.login}`]),
      el('button', {
        class: 'ghost-button logout-button',
        onclick: async () => {
          try { await api.post('/api/auth/logout', {}); } catch { /* ignore */ }
          setToken(null);
          currentUser = null;
          routeUnauthenticated();
        }
      }, ['⏻ Déconnexion'])
    ].filter(Boolean))
  ]);
}

function startEditingHouseholdName(titleRow, household) {
  const input = el('input', { type: 'text', class: 'household-name-input', value: household.name, maxlength: '100' });
  titleRow.innerHTML = '';
  titleRow.appendChild(input);
  input.focus();
  input.select();

  let done = false;
  async function save() {
    if (done) return;
    const nextName = input.value.trim();
    if (!nextName || nextName === household.name) { done = true; renderShellForRoute(); return; }
    done = true;
    try {
      await api.put('/api/household', { name: nextName });
      household.name = nextName;
      toast('Nom du foyer mis à jour.', { type: 'success' });
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
    renderShellForRoute();
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    else if (e.key === 'Escape') { done = true; renderShellForRoute(); }
  });
  input.addEventListener('blur', save);
}

async function renderShellForRoute() {
  if (!currentUser) { await routeUnauthenticated(); return; }
  appRoot.innerHTML = '';
  const shell = el('div', { class: 'app-shell' });
  shell.appendChild(buildTopbar());
  const viewRoot = el('div', { class: 'view-root' });
  shell.appendChild(viewRoot);
  appRoot.appendChild(shell);

  const isAdmin = currentUser.role === 'ADMIN';
  let route = currentRoute();
  if (!route) route = isAdmin ? 'admin' : 'dashboard';

  if (isAdmin) {
    if (route === 'settings') await renderSettings(viewRoot, currentUser);
    else await renderAdmin(viewRoot);
    return;
  }

  if (currentHouseholds.length === 0) {
    viewRoot.appendChild(el('p', { class: 'empty-state' }, ["Vous n'êtes associé à aucun foyer pour le moment. Contactez un administrateur."]));
    return;
  }

  const navItem = MEMBER_NAV.find((n) => n.path === route) || MEMBER_NAV[0];
  await navItem.render(viewRoot, { user: currentUser });
}

window.addEventListener('hashchange', () => renderShellForRoute());

boot();
