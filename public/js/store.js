'use strict';

const listeners = new Set();

const state = {
  user: null, // { id, login, role, themePreference }
  households: [], // [{ id, name, currencyCode, isActive }]
  currentHouseholdId: null,
  view: 'loading'
};

function setState(patch) {
  Object.assign(state, patch);
  for (const fn of listeners) fn(state);
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export { state, setState, subscribe };
