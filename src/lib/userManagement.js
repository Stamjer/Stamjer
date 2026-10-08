import { isAdmin } from '../../shared/roles.js'

export const USER_STATUS_LABELS = { active: 'Actief', inactive: 'Inactief', legacy: 'Alumni' }

export function filterManagedUsers(users, { search = '', status = 'all', role = 'all', sort = 'name' } = {}) {
  const term = search.trim().toLocaleLowerCase('nl-NL')
  const statusOrder = { active: 0, inactive: 1, legacy: 2 }
  return users.filter((user) => (status === 'all' || user.status === status)
    && (role === 'all' || (isAdmin(user) ? 'admin' : 'user') === role)
    && (!term || `${user.firstName} ${user.lastName} ${user.email || ''}`.toLocaleLowerCase('nl-NL').includes(term)))
    .sort((a, b) => {
      const primary = sort === 'status' ? statusOrder[a.status] - statusOrder[b.status]
        : sort === 'streepjes' ? (b.streepjes || 0) - (a.streepjes || 0) : 0
      return primary || `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, 'nl-NL')
    })
}
