import React, { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createUser, getUserGroupHistory, updateManagedUser } from '../services/api'
import { queryKeys } from '../lib/queryClient'
import { filterManagedUsers, USER_STATUS_LABELS } from '../lib/userManagement'
import { isAdmin, isDeveloper } from '../../shared/roles'
import ManagementDialog from './ManagementDialog'
import UserGroupMoveDialog from './UserGroupMoveDialog'
import UserPasswordEmailDialog from './UserPasswordEmailDialog'
import './UserManagementPanel.css'

export default function UserManagementPanel({ actor, users = [], groupId, groups = [], loading = false, error }) {
  const queryClient = useQueryClient()
  const developer = isDeveloper(actor)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [role, setRole] = useState('all')
  const [sort, setSort] = useState('name')
  const [editing, setEditing] = useState(null)
  const [moving, setMoving] = useState(null)
  const [passwordEmail, setPasswordEmail] = useState(null)
  const [form, setForm] = useState({})
  const [message, setMessage] = useState('')
  const [formError, setFormError] = useState('')
  const visible = useMemo(() => filterManagedUsers(users, { search, status, role, sort }), [users, search, status, role, sort])
  const counts = useMemo(() => ({
    active: users.filter((user) => user.status === 'active').length,
    inactive: users.filter((user) => user.status === 'inactive').length,
    legacy: users.filter((user) => user.status === 'legacy').length,
    admins: users.filter(isAdmin).length
  }), [users])
  const currentGroup = groups.find((group) => group.id === groupId)
  const archived = currentGroup?.status === 'archived' || (!developer && actor.permissions?.canManageUsers === false)
  const historyScope = developer ? groupId || '__all__' : undefined
  const historyQuery = useQuery({ queryKey: queryKeys.users.history(historyScope), queryFn: () => getUserGroupHistory(historyScope), refetchInterval: 15_000 })
  const mutation = useMutation({
    mutationFn: async () => {
      const data = { firstName: form.firstName, lastName: form.lastName, email: form.email }
      if (editing.id) {
        if (form.status !== editing.status) data.status = form.status
        if (developer && form.role !== editing.role) data.role = form.role
        return updateManagedUser(editing.id, data)
      }
      if (developer) { data.groupId = groupId; data.role = form.role }
      return createUser(data)
    },
    onSuccess: async () => {
      setMessage(editing.id ? 'Gebruiker bijgewerkt.' : 'Gebruiker toegevoegd. De gebruiker kan via Wachtwoord vergeten een wachtwoord instellen.')
      setEditing(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.users.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.events.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.developer.all })
      ])
    },
    onError: failure => setFormError(failure.message)
  })
  const open = (user = {}) => {
    setEditing(user)
    setForm({ firstName: user.firstName || '', lastName: user.lastName || '', email: user.email || '', status: user.status || 'active', role: user.role || 'user' })
    setFormError('')
    setMessage('')
  }
  const input = field => ({ value: form[field] || '', onChange: event => setForm(current => ({ ...current, [field]: event.target.value })) })
  const groupName = id => groups.find(group => group.id === id)?.name || id
  return (
    <section className="user-management" aria-label="Gebruikersbeheer">
      <div className="management-heading"><div><h2>Gebruikersbeheer</h2><p>{counts.active} actief · {counts.inactive} inactief · {counts.legacy} alumni · {counts.admins} beheerders</p></div>
        <button className="btn btn-primary" onClick={() => open()} disabled={loading || archived || (developer && !groupId)}>Gebruiker toevoegen</button></div>
      <div className="management-toolbar">
        <label>Zoeken<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Naam of e-mailadres" /></label>
        <label>Status<select value={status} onChange={event => setStatus(event.target.value)}><option value="all">Alle statussen</option>{Object.entries(USER_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Rol<select value={role} onChange={event => setRole(event.target.value)}><option value="all">Alle rollen</option><option value="admin">Beheerders</option><option value="user">Gebruikers</option></select></label>
        <label>Sorteren<select value={sort} onChange={event => setSort(event.target.value)}><option value="name">Naam</option><option value="status">Status</option><option value="streepjes">Streepjes</option></select></label>
      </div>
      {error && <p role="alert" className="management-error">{error.message}</p>}
      {message && <p role="status" className="management-success">{message}</p>}
      {archived && <p>Deze groep is gearchiveerd. Gebruikers kunnen worden bekeken.</p>}
      {loading ? <p role="status">Gebruikers laden…</p> : visible.length === 0 ? <p>Geen gebruikers gevonden.</p> : <ul className="management-users">
        {visible.map(user => <li key={user.id} className="management-user">
          <div className="management-user-identity"><strong>{user.firstName} {user.lastName}</strong><span>{user.email}</span>{developer && <span>{groupName(user.groupId)}</span>}</div>
          <div className="management-user-meta"><span className="management-badge">{isAdmin(user) ? 'Beheerder' : 'Gebruiker'}</span><span className={`management-badge status-${user.status}`}>{USER_STATUS_LABELS[user.status]}</span><span>{user.streepjes || 0} streepjes</span></div>
          <details className="management-actions"><summary aria-label={`Acties voor ${user.firstName} ${user.lastName}`}>Acties</summary><div><button type="button" disabled={archived || groups.some(group => group.id === user.groupId && group.status === 'archived')} onClick={event => { const menu = event.currentTarget.closest('details'); menu.open = false; menu.querySelector('summary').focus(); open(user) }}>Bewerken</button>
            {developer && <button type="button" disabled={archived || groups.some(group => group.id === user.groupId && group.status === 'archived') || !groups.some(group => group.status === 'active' && group.id !== user.groupId)} onClick={event => { const menu = event.currentTarget.closest('details'); menu.open = false; menu.querySelector('summary').focus(); setMessage(''); setMoving(user) }}>Verplaatsen</button>}
            <button type="button" disabled={archived || groups.some(group => group.id === user.groupId && group.status === 'archived')} onClick={event => { const menu = event.currentTarget.closest('details'); menu.open = false; menu.querySelector('summary').focus(); setMessage(''); setPasswordEmail(user) }}>Wachtwoord-e-mail</button>
          </div></details>
        </li>)}
      </ul>}
      {historyQuery.error && <p role="alert" className="management-error">Groepsarchief laden mislukt: {historyQuery.error.message}</p>}
      {historyQuery.data?.history?.length > 0 && <details className="management-history"><summary>Groepsarchief · {historyQuery.data.history.length} verplaatsingen</summary><p>Historie van vertrokken leden blijft in hun oude groep. Deze streepjes tellen niet mee in een nieuwe groep.</p>
        {historyQuery.data.history.map(record => <details key={record.id}><summary>{record.name} · {record.streepjes} streepjes · {new Date(record.movedAt).toLocaleDateString('nl-NL')}{developer ? ` · ${groupName(record.groupId)}` : ''}</summary>
          <ul>{record.events.map(event => <li key={event.eventId}><strong>{event.title}</strong> · {new Date(event.start).toLocaleDateString('nl-NL')} · {event.participant ? 'Aangemeld' : 'Niet aangemeld'}{event.opkomstmaker ? ' · Opkomstmaker' : ''}{event.schoonmaker ? ' · Schoonmaker' : ''}{event.attendance === null ? '' : event.attendance ? ' · Aanwezig' : ' · Afwezig'} · {event.streepjes} streepjes{event.future ? ' · Toekomstig bij vertrek' : ''}</li>)}</ul>
        </details>)}
      </details>}
      {moving && <UserGroupMoveDialog user={moving} groups={groups} onClose={() => setMoving(null)} onMoved={setMessage} />}
      {passwordEmail && <UserPasswordEmailDialog user={passwordEmail} onClose={() => setPasswordEmail(null)} onSent={setMessage} />}
      {editing && <ManagementDialog title={editing.id ? 'Gebruiker bewerken' : 'Gebruiker toevoegen'} busy={mutation.isPending} onClose={() => setEditing(null)}>
        <form className="management-form" onSubmit={event => { event.preventDefault(); setFormError(''); mutation.mutate() }}>
          <label>Voornaam<input {...input('firstName')} autoFocus required maxLength={80} /></label>
          <label>Achternaam<input {...input('lastName')} required maxLength={120} /></label>
          <label>E-mailadres<input {...input('email')} type="email" required maxLength={254} /></label>
          {editing.id && <label>Status<select {...input('status')}>{Object.entries(USER_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
          {developer && <label>Rol<select {...input('role')}><option value="user">Gebruiker</option><option value="admin">Beheerder</option></select></label>}
          {developer && <p>Groep: {groupName(editing.groupId || groupId)}</p>}
          {!editing.id && <p>De gebruiker stelt een wachtwoord in via Wachtwoord vergeten.</p>}
          {formError && <p role="alert" className="management-error">{formError}</p>}
          <div className="management-form-actions"><button type="button" className="btn btn-secondary" disabled={mutation.isPending} onClick={() => setEditing(null)}>Annuleren</button><button type="submit" className="btn btn-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Opslaan…' : 'Opslaan'}</button></div>
        </form>
      </ManagementDialog>}
    </section>
  )
}
