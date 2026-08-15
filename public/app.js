const currency = (value) => new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR'
}).format(Number(value || 0));

const state = {
  theme: localStorage.getItem('capbudget-theme') || 'light',
  token: localStorage.getItem('capbudget-token') || '',
  user: null,
  budgetTypes: [],
  categories: [],
  subcategories: [],
  rules: []
};

const applyTheme = () => {
  document.body.classList.toggle('dark', state.theme === 'dark');
};

const setAuthToken = (token) => {
  state.token = token || '';
  if (token) localStorage.setItem('capbudget-token', token);
  else localStorage.removeItem('capbudget-token');
};

const getHeaders = () => ({
  'Content-Type': 'application/json',
  ...(state.token ? { Authorization: `Bearer ${state.token}` } : {})
});

const renderBudgetBreakdown = (items = []) => {
  const panel = document.getElementById('budgetBreakdown');
  panel.innerHTML = '';

  if (!items.length) {
    panel.innerHTML = '<div class="empty-state">Aucun objectif budgétaire pour ce foyer.</div>';
    return;
  }

  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'category-row';
    row.innerHTML = `
      <div class="category-meta">
        <span class="dot" style="background:${item.color || '#3b82f6'}"></span>
        <span class="category-name">${item.name}</span>
      </div>
      <div>
        <div class="category-value">${Number(item.targetPercent || 0)}%</div>
        <div class="category-subtle">${currency(item.spend)}</div>
      </div>
    `;
    panel.appendChild(row);
  });
};

const renderTransactions = (items = []) => {
  const container = document.getElementById('transactionList');
  container.innerHTML = '';

  if (!items.length) {
    container.innerHTML = '<div class="empty-state">Aucune transaction pour le moment.</div>';
    return;
  }

  items.forEach((txn) => {
    const row = document.createElement('div');
    row.className = 'transaction-row';
    const signedClass = txn.kind === 'INCOME' ? 'amount-income' : 'amount-expense';
    const percent = Number(txn.donutPercent || 0);
    const color = txn.budget_type_color || '#3b82f6';
    const angle = Math.min(360, Math.max(0, (percent / 100) * 360));

    row.innerHTML = `
      <div class="transaction-main">
        <span class="transaction-label">${txn.label}</span>
        <span class="transaction-sub">${txn.operation_date} • ${txn.category || 'Sans catégorie'} • ${txn.account_label || 'Compte principal'}</span>
      </div>
      <div class="transaction-right">
        <div class="mini-donut" style="background: conic-gradient(${color} 0 ${angle}deg, rgba(148,163,184,0.18) ${angle}deg 360deg);">
          <span class="mini-donut-label">${Math.round(percent)}%</span>
        </div>
        <span class="transaction-amount ${signedClass}">${txn.formattedAmount || currency(txn.amount)}</span>
      </div>
    `;
    container.appendChild(row);
  });
};

const renderCategories = (items = []) => {
  const detail = document.getElementById('categoryListDetail');
  const select = document.getElementById('categoryTypeSelect');
  const ruleCategorySelect = document.getElementById('ruleCategorySelect');
  detail.innerHTML = '';
  select.innerHTML = '<option value="">Aucun type cible</option>';
  ruleCategorySelect.innerHTML = '<option value="">Choisir une catégorie</option>';

  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'category-row';
    row.innerHTML = `
      <div class="category-meta">
        <span class="dot" style="background:${item.color || '#3b82f6'}"></span>
        <span class="category-name">${item.name}</span>
      </div>
      <span class="category-subtle">${item.budget_type_name || 'Sans objectif'}</span>
    `;
    detail.appendChild(row);

    if (item.budget_type_id) {
      const option = document.createElement('option');
      option.value = item.budget_type_id;
      option.textContent = item.name;
      select.appendChild(option);
    }

    const ruleOption = document.createElement('option');
    ruleOption.value = item.id;
    ruleOption.textContent = item.name;
    ruleCategorySelect.appendChild(ruleOption);
  });
};

const renderSubcategories = (items = []) => {
  const detail = document.getElementById('subcategoryListDetail');
  const select = document.getElementById('subcategoryCategorySelect');
  const ruleSelect = document.getElementById('ruleSubcategorySelect');
  detail.innerHTML = '';
  select.innerHTML = '<option value="">Choisir une catégorie</option>';
  ruleSelect.innerHTML = '<option value="">Aucune sous-catégorie</option>';

  state.categories.forEach((category) => {
    const categoryOption = document.createElement('option');
    categoryOption.value = category.id;
    categoryOption.textContent = category.name;
    select.appendChild(categoryOption);
  });

  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'category-row';
    row.innerHTML = `
      <div class="category-meta">
        <span class="dot" style="background:${item.color || '#94a3b8'}"></span>
        <span class="category-name">${item.name}</span>
      </div>
      <span class="category-subtle">${item.category_name || 'Catégorie'}</span>
    `;
    detail.appendChild(row);

    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = `${item.category_name} / ${item.name}`;
    ruleSelect.appendChild(option);
  });
};

const renderRules = (items = []) => {
  const detail = document.getElementById('ruleListDetail');
  detail.innerHTML = '';

  if (!items.length) {
    detail.innerHTML = '<div class="empty-state">Aucune règle enregistrée.</div>';
    return;
  }

  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'category-row';
    row.innerHTML = `
      <div class="category-meta">
        <span class="dot" style="background:#22c55e"></span>
        <span class="category-name">${item.name}</span>
      </div>
      <span class="category-subtle">${item.match_type} ${item.match_value} → ${item.category_name || 'sans catégorie'}</span>
    `;
    detail.appendChild(row);
  });
};

const renderCashflows = (items = []) => {
  const container = document.getElementById('cashflowList');
  container.innerHTML = '';
  if (!items.length) {
    container.innerHTML = '<div class="empty-state">Aucun cashflow.</div>';
    return;
  }
  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'category-row';
    row.innerHTML = `
      <div class="category-meta">
        <span class="dot" style="background:${item.color || '#3b82f6'}"></span>
        <span class="category-name">${item.name}</span>
      </div>
      <span class="category-subtle">${item.is_default ? 'Par défaut' : 'Standard'}</span>
    `;
    container.appendChild(row);
  });
};

const renderAccounts = (items = []) => {
  const container = document.getElementById('accountList');
  container.innerHTML = '';
  if (!items.length) {
    container.innerHTML = '<div class="empty-state">Aucun compte.</div>';
    return;
  }
  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'category-row';
    row.innerHTML = `
      <div class="category-meta">
        <span class="dot" style="background:#8b5cf6"></span>
        <span class="category-name">${item.account_label}</span>
      </div>
      <span class="category-subtle">${item.is_archived ? 'Archivé' : 'Actif'}</span>
    `;
    container.appendChild(row);
  });
};

const renderAudit = (items = []) => {
  const container = document.getElementById('auditList');
  container.innerHTML = '';
  if (!items.length) {
    container.innerHTML = '<div class="empty-state">Aucun événement d’audit.</div>';
    return;
  }
  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'transaction-row';
    row.innerHTML = `
      <div class="transaction-main">
        <span class="transaction-label">${item.action} • ${item.entity_type}</span>
        <span class="transaction-sub">${item.user_login} • ${new Date(item.created_at).toLocaleString('fr-FR')}</span>
      </div>
      <span class="category-subtle">${item.entity_id || 'n/a'}</span>
    `;
    container.appendChild(row);
  });
};

const renderAdminUsers = (items = []) => {
  const list = document.getElementById('adminUserList');
  const select = document.getElementById('adminUserHouseholdSelect');
  list.innerHTML = '';
  select.innerHTML = '<option value="">Aucun foyer</option>';

  if (!items.length) {
    list.innerHTML = '<div class="empty-state">Aucun utilisateur.</div>';
    return;
  }

  (async () => {
    const householdRes = await fetch('/api/households', { headers: getHeaders() });
    if (householdRes.ok) {
      const households = await householdRes.json();
      households.forEach((household) => {
        const option = document.createElement('option');
        option.value = household.id;
        option.textContent = household.name;
        select.appendChild(option);
      });
    }
  })();

  items.forEach((user) => {
    const row = document.createElement('div');
    row.className = 'category-row';
    row.innerHTML = `
      <div class="category-meta">
        <span class="dot" style="background:${user.role === 'ADMIN' ? '#7c3aed' : '#22c55e'}"></span>
        <span class="category-name">${user.login}</span>
      </div>
      <span class="category-subtle">${user.role} • ${user.household_ids.length ? user.household_ids.length + ' foyer(s)' : 'sans foyer'}</span>
    `;
    list.appendChild(row);
  });
};

const renderBudgetTypes = (items = []) => {
  const list = document.getElementById('budgetTypeList');
  list.innerHTML = '';
  const total = items.reduce((sum, item) => sum + Number(item.percentage || 0), 0);
  const warning = document.getElementById('budgetTypeWarning');
  warning.classList.toggle('hidden', Math.abs(total - 100) < 0.01 || total === 0);

  if (!items.length) {
    list.innerHTML = '<div class="empty-state">Aucun objectif budgétaire configuré.</div>';
    return;
  }

  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'category-row';
    row.innerHTML = `
      <div class="category-meta">
        <span class="dot" style="background:${item.color || '#3b82f6'}"></span>
        <span class="category-name">${item.name}</span>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="category-value">${Number(item.percentage || 0)}%</span>
        <button type="button" class="ghost-button" data-edit-budget="${item.id}">Éditer</button>
      </div>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll('[data-edit-budget]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = items.find((entry) => entry.id === button.dataset.editBudget);
      if (!item) return;
      document.getElementById('budgetTypeEditId').value = item.id;
      document.getElementById('budgetTypeName').value = item.name;
      document.getElementById('budgetTypeColor').value = item.color || '#3b82f6';
      document.getElementById('budgetTypePercentage').value = item.percentage || 0;
      document.getElementById('budgetTypeSubmit').textContent = 'Mettre à jour';
    });
  });
};

const renderDashboard = (data) => {
  document.getElementById('incomeValue').textContent = currency(data.totals.income);
  document.getElementById('expenseValue').textContent = currency(data.totals.expenses);
  document.getElementById('remainingValue').textContent = currency(data.totals.remaining);
  renderBudgetBreakdown(data.budgetBreakdown || []);
  renderTransactions(data.transactions || []);
};

const loadBudgetTypes = async () => {
  const res = await fetch('/api/budget-types', { headers: getHeaders() });
  if (!res.ok) return [];
  const items = await res.json();
  state.budgetTypes = items;
  renderBudgetTypes(items);
  const select = document.getElementById('categoryTypeSelect');
  select.innerHTML = '<option value="">Aucun type cible</option>';
  items.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = `${item.name} (${item.percentage}%)`;
    select.appendChild(option);
  });
  return items;
};

const loadCategories = async () => {
  const res = await fetch('/api/categories', { headers: getHeaders() });
  if (!res.ok) return [];
  const items = await res.json();
  state.categories = items;
  renderCategories(items);
  return items;
};

const loadSubcategories = async () => {
  const res = await fetch('/api/subcategories', { headers: getHeaders() });
  if (!res.ok) return [];
  const items = await res.json();
  state.subcategories = items;
  renderSubcategories(items);
  return items;
};

const loadRules = async () => {
  const res = await fetch('/api/categorization-rules', { headers: getHeaders() });
  if (!res.ok) return [];
  const items = await res.json();
  state.rules = items;
  renderRules(items);
  return items;
};

const loadCashflows = async () => {
  const res = await fetch('/api/cashflows', { headers: getHeaders() });
  if (!res.ok) return [];
  const items = await res.json();
  renderCashflows(items);
  return items;
};

const loadAccounts = async () => {
  const res = await fetch('/api/accounts', { headers: getHeaders() });
  if (!res.ok) return [];
  const items = await res.json();
  renderAccounts(items);
  return items;
};

const loadAudit = async () => {
  const res = await fetch('/api/audit', { headers: getHeaders() });
  if (!res.ok) return [];
  const items = await res.json();
  renderAudit(items);
  return items;
};

const loadAdminUsers = async () => {
  const res = await fetch('/api/admin/users', { headers: getHeaders() });
  if (!res.ok) return [];
  const items = await res.json();
  renderAdminUsers(items);
  return items;
};

const refreshDashboard = async () => {
  const res = await fetch('/api/dashboard', { headers: getHeaders() });
  if (!res.ok) throw new Error('Impossible de charger le dashboard');
  const data = await res.json();
  renderDashboard(data);
};

const showApp = () => {
  document.getElementById('loginView').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
};

const showLogin = () => {
  document.getElementById('loginView').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
};

const loadUser = async () => {
  const res = await fetch('/api/me', { headers: getHeaders() });
  if (!res.ok) {
    setAuthToken('');
    showLogin();
    return;
  }

  const data = await res.json();
  state.user = data.user;
  if (data.user) {
    showApp();
    const adminPanel = document.getElementById('adminPanel');
    const memberDashboard = document.getElementById('memberDashboard');
    const memberDashboardContent = document.getElementById('memberDashboardContent');
    const memberDashboardContentLower = document.getElementById('memberDashboardContentLower');

    if (data.user.role === 'ADMIN') {
      adminPanel.classList.remove('hidden');
      memberDashboard.classList.add('hidden');
      memberDashboardContent.classList.add('hidden');
      memberDashboardContentLower.classList.add('hidden');
      await loadAdminUsers();
    } else {
      adminPanel.classList.add('hidden');
      memberDashboard.classList.remove('hidden');
      memberDashboardContent.classList.remove('hidden');
      memberDashboardContentLower.classList.remove('hidden');
      await Promise.all([loadBudgetTypes(), loadCategories(), loadSubcategories(), loadRules(), loadCashflows(), loadAccounts(), loadAudit(), refreshDashboard()]);
    }
  } else {
    showLogin();
  }
};

const submitLogin = async (event) => {
  event.preventDefault();
  const login = document.getElementById('loginInput').value.trim();
  const password = document.getElementById('passwordInput').value;

  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password })
  });

  const data = await res.json();
  if (!res.ok) {
    alert(data.error || 'Connexion impossible');
    return;
  }

  setAuthToken(data.token);
  await loadUser();
};

const submitTransaction = async (event) => {
  event.preventDefault();
  const payload = {
    label: document.getElementById('transactionLabel').value,
    amount: Number(document.getElementById('transactionAmount').value),
    kind: document.getElementById('transactionKind').value,
    operationDate: document.getElementById('transactionDate').value,
    category: document.getElementById('transactionCategory').value || 'Autre',
    accountLabel: 'Compte principal'
  };

  const res = await fetch('/api/transactions', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const error = await res.json();
    alert(error.error || 'Erreur lors de la création');
    return;
  }

  event.target.reset();
  document.getElementById('transactionDate').value = new Date().toISOString().slice(0, 10);
  await refreshDashboard();
};

const submitCategory = async (event) => {
  event.preventDefault();
  const payload = {
    name: document.getElementById('categoryName').value,
    kind: document.getElementById('categoryKind').value,
    color: document.getElementById('categoryColor').value,
    budgetTypeId: document.getElementById('categoryTypeSelect').value || null
  };

  const res = await fetch('/api/categories', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const error = await res.json();
    alert(error.error || 'Erreur lors de la création');
    return;
  }

  event.target.reset();
  document.getElementById('categoryColor').value = '#3b82f6';
  await loadCategories();
  await refreshDashboard();
};

const submitBudgetType = async (event) => {
  event.preventDefault();
  const id = document.getElementById('budgetTypeEditId').value;
  const payload = {
    name: document.getElementById('budgetTypeName').value.trim(),
    color: document.getElementById('budgetTypeColor').value,
    percentage: Number(document.getElementById('budgetTypePercentage').value)
  };

  if (!payload.name || Number.isNaN(payload.percentage)) {
    alert('Nom et pourcentage requis.');
    return;
  }

  const method = id ? 'PUT' : 'POST';
  const url = id ? `/api/budget-types/${id}` : '/api/budget-types';
  const res = await fetch(url, {
    method,
    headers: getHeaders(),
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert(data.error || 'Impossible d’enregistrer le type budgétaire.');
    return;
  }

  document.getElementById('budgetTypeForm').reset();
  document.getElementById('budgetTypeEditId').value = '';
  document.getElementById('budgetTypeSubmit').textContent = 'Enregistrer';
  document.getElementById('budgetTypeColor').value = '#3b82f6';
  await loadBudgetTypes();
  await refreshDashboard();
};

const submitSubcategory = async (event) => {
  event.preventDefault();
  const payload = {
    categoryId: document.getElementById('subcategoryCategorySelect').value,
    name: document.getElementById('subcategoryName').value,
    color: document.getElementById('subcategoryColor').value
  };

  const res = await fetch('/api/subcategories', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert(data.error || 'Impossible d’ajouter la sous-catégorie.');
    return;
  }

  event.target.reset();
  document.getElementById('subcategoryColor').value = '#94a3b8';
  await loadSubcategories();
  await loadRules();
};

const submitRule = async (event) => {
  event.preventDefault();
  const payload = {
    name: document.getElementById('ruleName').value,
    matchField: document.getElementById('ruleField').value,
    matchType: document.getElementById('ruleType').value,
    matchValue: document.getElementById('ruleValue').value,
    categoryId: document.getElementById('ruleCategorySelect').value || null,
    subcategoryId: document.getElementById('ruleSubcategorySelect').value || null
  };

  const res = await fetch('/api/categorization-rules', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert(data.error || 'Impossible d’ajouter la règle.');
    return;
  }

  event.target.reset();
  await loadRules();
};

const submitAdminUser = async (event) => {
  event.preventDefault();
  const payload = {
    login: document.getElementById('adminUserLogin').value.trim(),
    password: document.getElementById('adminUserPassword').value,
    role: document.getElementById('adminUserRole').value,
    householdId: document.getElementById('adminUserHouseholdSelect').value || null
  };

  if (!payload.login || !payload.password) {
    alert('Login et mot de passe requis.');
    return;
  }

  const res = await fetch('/api/admin/users', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert(data.error || 'Impossible de créer l’utilisateur.');
    return;
  }

  event.target.reset();
  await loadAdminUsers();
};

const submitImport = async (event) => {
  event.preventDefault();
  const csvText = document.getElementById('csvInput').value.trim();
  if (!csvText) {
    alert('Collez un CSV avant d’importer.');
    return;
  }

  const resultEl = document.getElementById('importResult');
  const res = await fetch('/api/import/commit', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ csvText, filename: 'import.csv', delimiter: ';' })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    resultEl.textContent = data.error || 'Import impossible.';
    return;
  }

  resultEl.textContent = `Import validé : ${data.createdCount} créé(es), ${data.duplicateCount} doublon(s), ${data.errorCount} erreur(s).`;
  document.getElementById('csvInput').value = '';
  await loadAccounts();
  await refreshDashboard();
  await loadAudit();
};

const logout = async () => {
  await fetch('/api/auth/logout', {
    method: 'POST',
    headers: getHeaders()
  });
  setAuthToken('');
  showLogin();
};

document.getElementById('themeToggle').addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('capbudget-theme', state.theme);
  applyTheme();
});

document.getElementById('loginForm').addEventListener('submit', submitLogin);
document.getElementById('transactionForm').addEventListener('submit', submitTransaction);
document.getElementById('categoryForm').addEventListener('submit', submitCategory);
document.getElementById('subcategoryForm').addEventListener('submit', submitSubcategory);
document.getElementById('ruleForm').addEventListener('submit', submitRule);
document.getElementById('budgetTypeForm').addEventListener('submit', submitBudgetType);
document.getElementById('adminUserForm').addEventListener('submit', submitAdminUser);
document.getElementById('importForm').addEventListener('submit', submitImport);
document.getElementById('logoutButton').addEventListener('click', logout);
document.getElementById('newTransactionButton').addEventListener('click', () => {
  document.getElementById('transactionLabel').focus();
});
document.getElementById('transactionDate').value = new Date().toISOString().slice(0, 10);
document.getElementById('budgetTypeColor').value = '#3b82f6';

applyTheme();
if (state.token) {
  loadUser();
} else {
  showLogin();
}
