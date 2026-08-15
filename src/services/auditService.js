'use strict';

const { newId } = require('../util/ids');
const { db: coreDb } = require('../db/core');

function logHouseholdAudit(householdDb, householdId, userId, action, entityType, entityId, oldValue, newValue) {
  householdDb.prepare(`
    INSERT INTO household_audit_logs (id, household_id, user_id, action, entity_type, entity_id, old_value, new_value)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newId('audit'),
    householdId,
    userId,
    action,
    entityType,
    entityId || null,
    oldValue !== undefined ? JSON.stringify(oldValue) : null,
    newValue !== undefined ? JSON.stringify(newValue) : null
  );
}

function logGlobalAudit(userId, action, entityType, entityId, oldValue, newValue) {
  coreDb.prepare(`
    INSERT INTO global_audit_logs (id, user_id, action, entity_type, entity_id, old_value, new_value)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    newId('audit'),
    userId || null,
    action,
    entityType,
    entityId || null,
    oldValue !== undefined ? JSON.stringify(oldValue) : null,
    newValue !== undefined ? JSON.stringify(newValue) : null
  );
}

module.exports = { logHouseholdAudit, logGlobalAudit };
