
import {
  createDefaultGroup,
  DEFAULT_GROUP_ID,
  getEventGroupId,
  getUserGroupId,
  GROUP_INDEXES,
  isDeveloper,
  normalizeGroupUser,
  USER_ROLES
} from './groups.js'
import { sanitizeUserId } from './dataModel.js'
import { writeAudit } from './audit.js'

// Collections without implemented group ownership migration logic.
// Push subscriptions are intentionally preserved unchanged because
// notification functionality is not implemented in this checkout.
const UNSUPPORTED_GROUP_COLLECTIONS = [
  'dailySnapshots',
  'notifications',
  'scheduledNotifications'
]

// Known historical references to a deleted user.
// These records are preserved for historical attendance and participation.
// This exception applies only to the listed events before 2025-10-04.
const LEGACY_DELETED_USER_REFERENCES = new Map([
  [11, new Set([
    'ujzf',
    'trjo',
    'tfm4',
    '2xcs9z',
    'oi2axd',
    'j4fy8z',
    '6n4cjp',
    'uoasvj',
    '2nwzbq',
    '4yn6er',
    'uj1lhw'
  ])]
])

const LEGACY_EVENT_CUTOFF = '2025-10-04'

function isAllowedHistoricalReference(event, userId, usersById) {
  // Existing users must always pass normal group validation.
  if (usersById.has(userId)) return false

  const allowedEvents = LEGACY_DELETED_USER_REFERENCES.get(userId)
  if (!allowedEvents?.has(event.id)) return false

  // Only accept the known historical events.
  if (typeof event.start !== 'string') return false

  const date = event.start.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false

  return date < LEGACY_EVENT_CUTOFF
}

export function planGroupMigration({
  groups = [],
  users = [],
  events = [],
  unsupportedCollections = []
}) {
  const errors = unsupportedCollections.map(
    (name) =>
      `${name}: non-empty collection needs a separate ownership migration`
  )

  const groupIds = new Set([
    DEFAULT_GROUP_ID,
    ...groups.map((group) => group.id)
  ])

  const updates = {
    users: [],
    events: []
  }

  const seen = {
    userIds: new Set(),
    emails: new Set(),
    groupIds: new Set(),
    slugs: new Set()
  }

  // Validate existing groups.
  for (const group of groups) {
    if (seen.groupIds.has(group.id)) {
      errors.push(`groups/${group.id}: duplicate ID`)
    }

    if (seen.slugs.has(group.slug)) {
      errors.push(`groups/${group.id}: duplicate slug`)
    }

    seen.groupIds.add(group.id)
    seen.slugs.add(group.slug)
  }

  // Normalize and validate users.
  const normalizedUsers = users.map(normalizeGroupUser)

  for (const [index, user] of users.entries()) {
    const normalized = normalizedUsers[index]

    if (
      Object.hasOwn(user, 'role') &&
      !USER_ROLES.includes(user.role)
    ) {
      errors.push(`users/${user.id}: unknown role`)
    }

    if (!Number.isSafeInteger(user.id) || user.id <= 0) {
      errors.push(`users/${user.id}: invalid numeric ID`)
    }

    if (seen.userIds.has(user.id)) {
      errors.push(`users/${user.id}: duplicate ID`)
    }

    seen.userIds.add(user.id)

    const email =
      typeof user.email === 'string'
        ? user.email.trim().toLowerCase()
        : ''

    if (email && seen.emails.has(email)) {
      errors.push(
        `users/${user.id}: duplicate email (case-insensitive)`
      )
    }

    if (email) seen.emails.add(email)

    if (
      !isDeveloper(normalized) &&
      !groupIds.has(normalized.groupId)
    ) {
      errors.push(`users/${user.id}: unknown group`)
    }

    const fields = Object.fromEntries(
      ['role', 'groupId', 'isAdmin', 'isDeveloper', 'status']
        .filter((field) => user[field] !== normalized[field])
        .map((field) => [field, normalized[field]])
    )

    if (Object.keys(fields).length) {
      updates.users.push({
        id: user.id,
        fields
      })
    }
  }

  // Validate event ownership and user references.
  const usersById = new Map(
    normalizedUsers.map((user) => [user.id, user])
  )

  for (const event of events) {
    const groupId = getEventGroupId(event)

    if (!groupIds.has(groupId)) {
      errors.push(`events/${event.id}: unknown group`)
    }

    const ids = new Set([
      ...(Array.isArray(event.participants)
        ? event.participants
        : []),
      ...(Array.isArray(event.opkomstmakerIds)
        ? event.opkomstmakerIds
        : []),
      ...(Array.isArray(event.schoonmakerIds)
        ? event.schoonmakerIds
        : []),
      ...Object.keys(event.attendance || {})
    ].map(sanitizeUserId))

    for (const id of ids) {
      const user = usersById.get(id)

      // Preserve specifically identified historical references
      // to deleted users without weakening cross-group checks.
      if (
        !user &&
        isAllowedHistoricalReference(event, id, usersById)
      ) {
        continue
      }

      if (
        !user ||
        isDeveloper(user) ||
        getUserGroupId(user) !== groupId
      ) {
        errors.push(
          `events/${event.id}: invalid or cross-group reference to user ${id}`
        )
      }
    }

    if (event.groupId !== groupId) {
      updates.events.push({
        id: event.id,
        fields: { groupId }
      })
    }
  }

  return {
    createDefaultGroup: !groups.some(
      (group) => group.id === DEFAULT_GROUP_ID
    ),
    updates,
    errors
  }
}

export async function migrateGroups(
  db,
  { apply = false, defaultSettings = {} } = {}
) {
  if (await db.collection('schemaMigrations').findOne({ id: 'multi-group-v2' })) return { mode: apply ? 'apply' : 'dry-run', applied: false, errors: ['Initial group migration is retired after multi-group migration begins. Use the versioned membership migration.'] }
  const names = new Set(
    (
      await db.listCollections(
        {},
        { nameOnly: true }
      ).toArray()
    ).map(({ name }) => name)
  )

  const read = (name) =>
    names.has(name)
      ? db.collection(name).find({}).toArray()
      : Promise.resolve([])

  const [groups, users, events, unsupported] =
    await Promise.all([
      read('groups'),
      read('users'),
      read('events'),
      Promise.all(
        UNSUPPORTED_GROUP_COLLECTIONS
          .filter((name) => names.has(name))
          .map(async (name) =>
            (
              await db.collection(name).countDocuments(
                {},
                { limit: 1 }
              )
            ) > 0
              ? name
              : null
          )
      )
    ])

  const plan = planGroupMigration({
    groups,
    users,
    events,
    unsupportedCollections: unsupported.filter(Boolean)
  })

  const report = {
    mode: apply ? 'apply' : 'dry-run',
    defaultGroupNeeded: plan.createDefaultGroup,
    inspected: {
      groups: groups.length,
      users: users.length,
      events: events.length
    },
    updates: {
      users: plan.updates.users.length,
      events: plan.updates.events.length
    },
    errors: plan.errors,
    applied: false
  }

  // Never modify production when running a preview or when
  // validation detects an error.
  if (!apply || plan.errors.length) {
    return report
  }

  // Run only while all production database writers are stopped.
  // Existing documents and historical fields are not deleted.
  await db.collection('groups').updateOne(
    { id: DEFAULT_GROUP_ID },
    {
      $setOnInsert: createDefaultGroup(defaultSettings)
    },
    { upsert: true }
  )

  for (const [name, updates] of Object.entries(plan.updates)) {
    if (!updates.length) continue

    await db.collection(name).bulkWrite(
      updates.map(({ id, fields }) => ({
        updateOne: {
          filter: { id },
          update: { $set: fields }
        }
      })),
      { ordered: true }
    )
  }

  // Create or verify the indexes required by the groups system.
  for (const [name, definitions] of Object.entries(GROUP_INDEXES)) {
    for (const { keys, options } of definitions) {
      await db.collection(name).createIndex(keys, options)
    }
  }

  report.applied = true

  if (
    plan.createDefaultGroup ||
    plan.updates.users.length ||
    plan.updates.events.length
  ) {
    await writeAudit(db, {
      action: 'groups-migration-applied',
      groupId: DEFAULT_GROUP_ID,
      collection: 'groups',
      targetId: DEFAULT_GROUP_ID,
      changedFields: ['ownership', 'role', 'indexes']
    })
  }

  return report
}
