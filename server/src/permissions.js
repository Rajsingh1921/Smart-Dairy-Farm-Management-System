// Role-based access. The same list is sent to the browser so it can hide buttons,
// but every API route checks it again on the server.
const ALL = ['owner', 'manager', 'accountant', 'staff'];
const MGMT = ['owner', 'manager'];
const MONEY = ['owner', 'manager', 'accountant'];
const FIELD = ['owner', 'manager', 'staff'];

export const PERMISSIONS = {
  'dashboard.read': ALL,
  'finance.dashboard': MONEY,
  'animals.read': ALL,
  'animals.write': MGMT,
  'milk.read': ALL,
  'milk.write': FIELD,
  'milk.edit': MGMT, // editing or deleting a saved record (keeps history)
  'customers.read': ALL,
  'customers.write': MONEY,
  'deliveries.write': ['owner', 'manager', 'accountant', 'staff'],
  'billing.read': MONEY,
  'billing.write': MONEY,
  'inventory.read': ALL,
  'inventory.use': FIELD,
  'inventory.purchase': MONEY,
  'inventory.manage': MGMT,
  'health.read': ALL,
  'health.write': FIELD,
  'breeding.read': ALL,
  'breeding.write': FIELD,
  'finance.read': MONEY,
  'finance.write': MONEY,
  'employees.read': MGMT,
  'employees.write': MGMT,
  'salary.write': MONEY,
  'tasks.read': ALL,
  'tasks.write': MGMT,
  'reports.read': ALL,
  'reports.finance': MONEY,
  'reminders.read': ALL,
  'reminders.write': ALL,
  'settings.write': ['owner'],
  'users.manage': ['owner'],
  'backup.run': ['owner'],
  'records.delete': MGMT,
};

export function can(role, perm) {
  return (PERMISSIONS[perm] || []).includes(role);
}

export function permissionsFor(role) {
  return Object.keys(PERMISSIONS).filter((p) => can(role, p));
}
