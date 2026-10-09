import React, { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  changePassword, createEvent, createGroup, deleteEvent, getEvents, getGroups,
  getUsersFull, rotateCalendarToken, updateEvent, updateGroup
} from '../services/api'
import { queryKeys } from '../lib/queryClient'
import { nextDay, defaultEventTitle } from '../lib/eventPayload'
import UserManagementPanel from '../components/UserManagementPanel'
import ManagementDialog from '../components/ManagementDialog'
import DeveloperEventMembers from '../components/DeveloperEventMembers'
import DeveloperDatabasePanel from '../components/DeveloperDatabasePanel'
import './DeveloperPage.css'
import { hasPendingGroupWrites } from '../lib/groupContext'
import '../components/UserManagementPanel.css'

const QUERY_OPTIONS = { staleTime: 0, refetchInterval: 15_000 }
const GROUP_SETTINGS = {
  defaultLocation: 'Standaardlocatie', calendarName: 'Agendanaam',
  paymentRequestEmail: 'Declaraties naar', dailyChangeEmail: 'Statuswijzigingen naar'
}

function GroupEditor({ group, onClose }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    id: group?.id || '', name: group?.name || '', slug: group?.slug || '',
    status: group?.status || 'active',
    settings: {
      ...Object.fromEntries(Object.keys(GROUP_SETTINGS).map(key => [key, group?.settings?.[key] || ''])),
      allowUserSelfAttendance: group?.settings?.allowUserSelfAttendance !== false,
      enablePaymentRequests: group?.settings?.enablePaymentRequests !== false,
      enableStreepjes: group?.settings?.enableStreepjes !== false
    }
  })
  const mutation = useMutation({
    mutationFn: () => {
      const data = { name: form.name, slug: form.slug || form.id, status: form.status, settings: form.settings }
      return group ? updateGroup(group.id, data) : createGroup({ ...data, id: form.id })
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: queryKeys.developer.all }); onClose() }
  })
  const field = key => ({ value: form[key], onChange: event => setForm(current => ({ ...current, [key]: event.target.value })) })
  return <ManagementDialog title={group ? 'Groep bewerken' : 'Groep toevoegen'} onClose={onClose} busy={mutation.isPending}>
    <form className="management-form" onSubmit={event => { event.preventDefault(); mutation.mutate() }}>
      {!group && <label>Groeps-ID<input {...field('id')} autoFocus required pattern="[a-z0-9][a-z0-9-]*" maxLength={80} placeholder="bijvoorbeeld explorers" /></label>}
      <label>Naam<input {...field('name')} autoFocus={Boolean(group)} required maxLength={120} /></label>
      <label>Slug<input {...field('slug')} pattern="[a-z0-9][a-z0-9-]*" maxLength={80} placeholder={form.id} /></label>
      <label>Status<select {...field('status')}><option value="active">Actief</option><option value="archived">Gearchiveerd</option></select></label>
      {form.status === 'archived' && <p>Een gearchiveerde groep blijft leesbaar. Gebruikers en evenementen kunnen pas na heractiveren worden gewijzigd.</p>}
      <label className="management-checkbox"><input name="enablePaymentRequests" type="checkbox" checked={form.settings.enablePaymentRequests} onChange={event => setForm(current => ({ ...current, settings: { ...current.settings, enablePaymentRequests: event.target.checked } }))} /> Declaraties inschakelen</label>
      <label className="management-checkbox"><input name="enableStreepjes" type="checkbox" checked={form.settings.enableStreepjes} onChange={event => setForm(current => ({ ...current, settings: { ...current.settings, enableStreepjes: event.target.checked } }))} /> Streepjes inschakelen</label>
      {Object.entries(GROUP_SETTINGS).map(([key, label]) => <label key={key}>{label}<input type={key.endsWith('Email') ? 'email' : 'text'} maxLength={key.endsWith('Email') ? 254 : 300} value={form.settings[key]} onChange={event => setForm(current => ({ ...current, settings: { ...current.settings, [key]: event.target.value } }))} /></label>)}
      <label className="management-checkbox"><input type="checkbox" checked={form.settings.allowUserSelfAttendance} onChange={event => setForm(current => ({ ...current, settings: { ...current.settings, allowUserSelfAttendance: event.target.checked } }))} /> Leden mogen hun eigen aanwezigheid wijzigen</label>
      {mutation.error && <p role="alert" className="management-error">{mutation.error.message}</p>}
      <div className="management-form-actions"><button type="button" className="btn btn-secondary" disabled={mutation.isPending} onClick={onClose}>Annuleren</button><button className="btn btn-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Opslaan…' : 'Opslaan'}</button></div>
    </form>
  </ManagementDialog>
}

function CalendarRotation({ group, onClose }) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: () => rotateCalendarToken(group.id),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: queryKeys.developer.groups() }); onClose() }
  })
  return <ManagementDialog title="Agenda-link vervangen" onClose={onClose} busy={mutation.isPending}>
    <div className="management-form"><p>Vervang de agenda-link voor {group.name}. Bestaande externe abonnementen stoppen met synchroniseren. Leden kunnen de nieuwe URL in Account kopiëren.</p>
      {mutation.error && <p role="alert" className="management-error">{mutation.error.message}</p>}
      <div className="management-form-actions"><button className="btn btn-secondary" disabled={mutation.isPending} onClick={onClose}>Annuleren</button><button className="btn btn-primary" disabled={mutation.isPending} onClick={() => mutation.mutate()}>Link vervangen</button></div>
    </div>
  </ManagementDialog>
}

function toLocalInput(value, allDay) {
  if (!value) return ''
  if (allDay) return value.slice(0, 10)
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(value)) return value.length === 10 ? `${value}T00:00` : value.slice(0, 16)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = number => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function EventEditor({ event, group, onClose }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    title: event?.title || '', start: toLocalInput(event?.start, event?.allDay), end: toLocalInput(event?.end, event?.allDay),
    allDay: Boolean(event?.allDay), location: event?.location || group?.settings?.defaultLocation || '',
    description: event?.description || '', isOpkomst: Boolean(event?.isOpkomst), isSchoonmaak: Boolean(event?.isSchoonmaak),
    participants: event?.participants || [], opkomstmakerIds: event?.opkomstmakerIds || [], schoonmakerIds: event?.schoonmakerIds || [],
    guestOpkomstmakers: event?.guestOpkomstmakers || [],
    attendance: event?.attendance || {}, schoonmaakOptions: event?.schoonmaakOptions || []
  })
  const mutation = useMutation({
    mutationFn: () => {
      const data = { ...form, end: form.end || (form.allDay ? nextDay(form.start) : form.start) }
      return event ? updateEvent(event.id, data) : createEvent({ ...data, groupId: group.id })
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: queryKeys.developer.all }); onClose() }
  })
  const field = key => ({ value: form[key], onChange: change => setForm(current => ({ ...current, [key]: change.target.value })) })
  return <ManagementDialog title={event ? 'Evenement bewerken' : 'Evenement toevoegen'} onClose={onClose} busy={mutation.isPending}>
    <form className="management-form" onSubmit={change => { change.preventDefault(); mutation.mutate() }}>
      <p>Groep: {group?.name || event?.groupId}</p>
      <label>Titel<input {...field('title')} required autoFocus /></label>
      <label className="management-checkbox"><input type="checkbox" checked={form.allDay} onChange={change => { const allDay = change.target.checked; setForm(current => ({ ...current, allDay, start: toLocalInput(current.start, allDay), end: toLocalInput(current.end, allDay) })) }} /> Hele dag</label>
      <label>Start<input {...field('start')} type={form.allDay ? 'date' : 'datetime-local'} required /></label>
      <label>{form.allDay ? 'Einde (eerste dag na het evenement)' : 'Einde'}<input {...field('end')} type={form.allDay ? 'date' : 'datetime-local'} /></label>
      <label>Locatie<input {...field('location')} /></label>
      <label>Beschrijving<textarea {...field('description')} rows={3} /></label>
      {['isOpkomst', 'isSchoonmaak'].map(key => <label className="management-checkbox" key={key}><input type="checkbox" checked={form[key]} onChange={change => { const checked = change.target.checked; setForm(current => ({ ...current, [key]: checked, title: checked && !current.title.trim() ? defaultEventTitle(key, group?.name) : current.title })) }} /> {key === 'isOpkomst' ? 'Opkomst' : 'Schoonmaak'}</label>)}
      <DeveloperEventMembers form={form} setForm={setForm} event={event} groupId={event?.groupId || group.id} />
      {mutation.error && <p role="alert" className="management-error">{mutation.error.message}</p>}
      <div className="management-form-actions"><button type="button" className="btn btn-secondary" disabled={mutation.isPending} onClick={onClose}>Annuleren</button><button className="btn btn-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Opslaan…' : 'Opslaan'}</button></div>
    </form>
  </ManagementDialog>
}

function DeveloperAccount({ user, onLogout }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const mutation = useMutation({
    mutationFn: () => changePassword(user.email, form.currentPassword, form.newPassword),
    onSuccess: () => { setForm({ currentPassword: '', newPassword: '', confirmPassword: '' }); setMessage('Wachtwoord gewijzigd.'); setError('') },
    onError: failure => setError(failure.message)
  })
  return <section className="developer-account"><div className="developer-account-card"><h2>Wachtwoord</h2>
    <form className="management-form" onSubmit={event => {
      event.preventDefault(); setMessage(''); setError('')
      if (form.newPassword !== form.confirmPassword) { setError('Nieuwe wachtwoorden komen niet overeen.'); return }
      mutation.mutate()
    }}>
      {Object.entries({ currentPassword: 'Huidig wachtwoord', newPassword: 'Nieuw wachtwoord', confirmPassword: 'Herhaal nieuw wachtwoord' }).map(([key, label]) => <label key={key}>{label}<input type="password" required minLength={key === 'currentPassword' ? undefined : 12} autoComplete={key === 'currentPassword' ? 'current-password' : 'new-password'} value={form[key]} onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))} /></label>)}
      {error && <p role="alert" className="management-error">{error}</p>}{message && <p role="status" className="management-success">{message}</p>}
      <button className="btn btn-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Opslaan…' : 'Wachtwoord wijzigen'}</button>
    </form></div><button className="btn btn-danger developer-logout" onClick={onLogout}>Uitloggen</button>
  </section>
}

export default function DeveloperPage({ user, onLogout }) {
  const queryClient = useQueryClient()
  const { pathname } = useLocation()
  const [managementTab, setManagementTab] = useState('groups')
  const [databaseTab, setDatabaseTab] = useState('database')
  const page = pathname === '/developer/account' ? 'account' : pathname === '/developer/database' ? 'database' : 'manage'
  const tab = page === 'account' ? 'account' : page === 'database' ? databaseTab : managementTab
  const setTab = page === 'database' ? setDatabaseTab : setManagementTab
  const [scope, setScope] = useState('__all__')
  const [groupEditor, setGroupEditor] = useState(null)
  const [rotation, setRotation] = useState(null)
  const [eventEditor, setEventEditor] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [search, setSearch] = useState('')
  const groupsQuery = useQuery({ queryKey: queryKeys.developer.groups(), queryFn: getGroups, ...QUERY_OPTIONS })
  const groups = groupsQuery.data?.groups || []
  const selectedGroup = groups.find(group => group.id === scope)
  const usersQuery = useQuery({ queryKey: queryKeys.developer.users(scope), queryFn: () => getUsersFull(scope), enabled: tab === 'users', ...QUERY_OPTIONS })
  const eventsQuery = useQuery({ queryKey: queryKeys.developer.events(scope), queryFn: () => getEvents(scope), enabled: tab === 'events', ...QUERY_OPTIONS })
  const deletion = useMutation({
    mutationFn: () => deleteEvent(deleting.id),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: queryKeys.developer.all }); setDeleting(null) }
  })
  const visibleGroups = groups.filter(group => (scope === '__all__' || group.id === scope) && `${group.name} ${group.id}`.toLowerCase().includes(search.toLowerCase()))
  if (!['/developer', '/developer/', '/developer/database', '/developer/account'].includes(pathname)) return <Navigate to="/developer" replace />
  return <div className="developer-page">
    {page !== 'account' && <header className="developer-heading">
      <label>Groep<select aria-label="Groep beheren" value={scope} onChange={event => {
        if (queryClient.isMutating() || hasPendingGroupWrites()) return
        if ((groupEditor || eventEditor || deleting || rotation) && !window.confirm('Van groep wisselen en het open formulier sluiten?')) return
        setGroupEditor(null); setEventEditor(null); setDeleting(null); setRotation(null); setScope(event.target.value); setSearch('')
      }}><option value="__all__">Alle groepen</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name || group.id}{group.status === 'archived' ? ' (gearchiveerd)' : ''}</option>)}</select></label>
      <nav className="developer-tabs" aria-label={page === 'database' ? 'Database onderdelen' : 'Beheer onderdelen'}>{Object.entries(page === 'database' ? { database: 'Database', audit: 'Audit' } : { groups: 'Groepen', users: 'Accounts', events: 'Evenementen' }).map(([key, label]) => <button type="button" key={key} className={tab === key ? 'is-active' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => { setTab(key); setSearch('') }}>{label}</button>)}</nav>
    </header>}
    {page !== 'account' && groupsQuery.error && <p role="alert" className="management-error">{groupsQuery.error.message}</p>}
    {tab === 'groups' && <section><div className="management-heading"><label className="developer-search">Groepen zoeken<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Naam of groeps-ID" /></label><button className="btn btn-primary" onClick={() => setGroupEditor({})}>Groep toevoegen</button></div>
      {groupsQuery.isPending ? <p role="status">Groepen laden…</p> : visibleGroups.length === 0 ? <p>Geen groepen gevonden.</p> : <div className="developer-groups">{visibleGroups.map(group => <article key={group.id} className="developer-group-card"><div><h2>{group.name || group.id}</h2><p>{group.id} · {group.status === 'archived' ? 'Gearchiveerd' : 'Actief'}</p></div><dl><div><dt>Leden</dt><dd>{group.summary.users}</dd></div><div><dt>Beheerders</dt><dd>{group.summary.admins}</dd></div><div><dt>Actief</dt><dd>{group.summary.activeUsers}</dd></div><div><dt>Komende opkomsten</dt><dd>{group.summary.futureOpkomsten}</dd></div></dl>
        <p>Laatste activiteit: {group.summary.latestActivity ? new Date(group.summary.latestActivity).toLocaleString('nl-NL') : 'Nog geen auditactiviteit'}</p>
        <div className="developer-card-actions"><button className="btn btn-secondary" onClick={() => setGroupEditor(group)}>Instellingen</button><button className="btn btn-secondary" onClick={() => { setScope(group.id); setTab('users') }}>Accounts</button>{group.hasCalendarSubscription && <button className="btn btn-secondary" onClick={() => setRotation(group)}>Agenda-link vervangen</button>}</div>
      </article>)}</div>}
    </section>}
    {tab === 'users' && <UserManagementPanel key={scope} actor={user} users={usersQuery.data?.users || []} groups={groups} groupId={selectedGroup?.id} loading={usersQuery.isPending} error={usersQuery.error} />}
    {tab === 'events' && <section className="developer-events"><div className="management-heading"><h2>Evenementen</h2><button className="btn btn-primary" disabled={!selectedGroup || selectedGroup.status !== 'active'} onClick={() => setEventEditor({ group: selectedGroup })}>Evenement toevoegen</button></div>
      {!selectedGroup && <p>Selecteer een groep om een evenement toe te voegen.</p>}
      {eventsQuery.error && <p role="alert" className="management-error">{eventsQuery.error.message}</p>}
      {eventsQuery.isPending ? <p role="status">Evenementen laden…</p> : !eventsQuery.data?.events?.length ? <p>Geen evenementen.</p> : <ul className="developer-event-list">{[...eventsQuery.data.events].sort((a, b) => String(b.start).localeCompare(String(a.start))).map(event => {
        const group = groups.find(group => group.id === event.groupId)
        return <li key={event.id}><div><strong>{event.title}</strong><span>{toLocalInput(event.start, event.allDay).replace('T', ' ')} · {group?.name || event.groupId}</span></div><div className="developer-card-actions"><button className="btn btn-secondary" disabled={group?.status !== 'active'} onClick={() => setEventEditor({ event, group })}>Bewerken</button><button className="btn btn-secondary" disabled={group?.status !== 'active'} onClick={() => { deletion.reset(); setDeleting(event) }}>Verwijderen</button></div></li>
      })}</ul>}
    </section>}
    {['database', 'audit'].includes(tab) && <DeveloperDatabasePanel key={`${tab}:${scope}`} scope={scope} audit={tab === 'audit'} />}
    {tab === 'account' && <DeveloperAccount user={user} onLogout={onLogout} />}
    {groupEditor && <GroupEditor group={groupEditor.id ? groupEditor : null} onClose={() => setGroupEditor(null)} />}
    {rotation && <CalendarRotation group={rotation} onClose={() => setRotation(null)} />}
    {eventEditor && <EventEditor {...eventEditor} onClose={() => setEventEditor(null)} />}
    {deleting && <ManagementDialog title="Evenement verwijderen" busy={deletion.isPending} onClose={() => setDeleting(null)}><div className="management-form"><p>Verwijder {deleting.title}? Dit verwijdert ook de opgeslagen aanwezigheid en streepjes voor dit evenement.</p>{deletion.error && <p role="alert" className="management-error">{deletion.error.message}</p>}<div className="management-form-actions"><button className="btn btn-secondary" disabled={deletion.isPending} onClick={() => setDeleting(null)}>Annuleren</button><button className="btn btn-primary" disabled={deletion.isPending} onClick={() => deletion.mutate()}>Verwijderen</button></div></div></ManagementDialog>}
  </div>
}
