import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getMemberships, addMembership, addExistingMembership, changeMembership, previewMembershipEnd, endMembership, rejoinMembership, getMembershipHistory, getGlobalUsers } from '../services/api'
import { isDeveloper } from '../../shared/roles'
import ManagementDialog from './ManagementDialog'
import './MembershipManager.css'

export default function MembershipManager({ actor, groupId: selectedGroupId, user: initialUser, groups, onClose, onChanged }) {
  const developer = isDeveloper(actor)
  const [user, setUser] = useState(initialUser)
  const [email, setEmail] = useState('')
  const [groupId, setGroupId] = useState('')
  const [preview, setPreview] = useState(null)
  const [history, setHistory] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const queryClient = useQueryClient()
  const directory = useQuery({ queryKey: ['developer', 'identities'], queryFn: getGlobalUsers, enabled: developer && !initialUser })
  const memberships = useQuery({ queryKey: ['memberships', actor.id, developer ? 'all' : selectedGroupId, user?.id], queryFn: () => getMemberships(user.id, developer ? undefined : selectedGroupId), enabled: Boolean(user) })
  const run = async work => {
    setBusy(true); setError(''); setPreview(null)
    try { await work(); await queryClient.invalidateQueries(); onChanged('Lidmaatschap bijgewerkt.') }
    catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  return <ManagementDialog title="Lidmaatschappen" busy={busy} onClose={onClose}><div className="management-form membership-manager">
    {!initialUser && developer && <label>Bestaand account<select aria-label="Bestaand account" disabled={busy || directory.isPending} value={user?.id || ''} onChange={e => { setUser(directory.data.users.find(u => u.id === Number(e.target.value))); setHistory(null); setPreview(null) }}>
      <option value="">Kies een account</option>{directory.data?.users.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName} · {u.email}</option>)}
    </select></label>}
    {!initialUser && !developer && !user && <form className="membership-add-form" onSubmit={e => { e.preventDefault(); run(async () => {
      const result = await addExistingMembership(email, selectedGroupId)
      setUser({ id: result.membership.userId, email })
    }) }}><label>E-mailadres bestaand account<input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <p>Vul het volledige e-mailadres in.</p>
      <button type="submit" className="btn btn-primary" disabled={busy}>Aan deze groep toevoegen</button></form>}
    {user && <div className="membership-identity"><strong>{user.firstName} {user.lastName}</strong><span>{user.email}</span></div>}
    {((developer && !initialUser && directory.isPending) || (user && memberships.isPending)) && <p role="status">Laden…</p>}
    {(memberships.error || directory.error || error) && <p role="alert" className="management-error">{error || memberships.error?.message || directory.error?.message}</p>}
    {memberships.data?.memberships.map(m => <section className="membership-card" key={m.id}>
      <div className="membership-card-heading"><h3>{groups.find(g => g.id === m.groupId)?.name || actor.memberships?.find(member => member.groupId === m.groupId)?.group.name || m.groupId}</h3><span className={`management-badge status-${m.state === 'ended' ? 'alumni' : m.status}`}>{m.state === 'ended' ? 'Alumni' : m.state === 'historical' ? 'Historisch (zonder toegang)' : m.status === 'inactive' ? 'Inactief' : 'Actief'}</span></div>
      <ul className="membership-periods">{m.periods.map(p => <li key={p.id}>{p.joinedAt === null ? 'Oorspronkelijke start onbekend' : new Date(p.joinedAt).toLocaleDateString('nl-NL')} – {p.endedAt ? new Date(p.endedAt).toLocaleDateString('nl-NL') : 'heden'}{p.endProvenance === 'migration-access-cutoff' && <span>Vertrekdatum onbekend; kalendergrens.</span>}</li>)}</ul>
      {m.state === 'current' && <div className="membership-fields">
        {developer && <label>Groepsrol<select disabled={busy} value={m.role} onChange={e => run(() => changeMembership(m.id, { role: e.target.value, revision: m._revision }))}><option value="user">Gebruiker</option><option value="admin">Beheerder</option></select></label>}
        <label>Groepsstatus<select disabled={busy} value={m.status} onChange={e => run(() => changeMembership(m.id, { status: e.target.value, revision: m._revision }))}><option value="active">Actief</option><option value="inactive">Inactief</option></select></label>
      </div>}
      <div className="membership-actions">
        {m.state === 'current' && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => run(async () => setPreview({ ...(await previewMembershipEnd(m.id)), membership: m }))}>Vertrek bekijken</button>}
        {m.state === 'ended' && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(() => rejoinMembership(m.id, m._revision))}>Opnieuw aansluiten</button>}
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => run(async () => setHistory(await getMembershipHistory(m.id)))}>Historie bekijken</button>
      </div>
    </section>)}
    {preview && <div className="membership-preview" role="status"><p>{preview.summary.futureEvents} toekomstige deelnames of taken worden geannuleerd. Historie en agenda-link blijven behouden.</p>
      <button type="button" className="btn btn-danger" disabled={busy} onClick={() => run(() => endMembership(preview.membership.id, preview.previewToken, preview.membership._revision))}>Vertrek bevestigen</button></div>}
    {history && <details className="membership-history" open><summary>Lidmaatschapshistorie</summary><ul>{history.history.map(record => <li key={record.id}>{new Date(record.timestamp).toLocaleString('nl-NL')} · {record.action} · {record.role} · {record.status}</li>)}</ul></details>}
    {user && developer && <div className="membership-add-form"><label>Groep toevoegen<select aria-label="Groep toevoegen" disabled={busy || memberships.isPending} value={groupId} onChange={e => setGroupId(e.target.value)}><option value="">Kies een groep</option>{groups.filter(g => g.status === 'active' && !memberships.data?.memberships.some(m => m.groupId === g.id)).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
      <button type="button" className="btn btn-primary" disabled={busy || !groupId || memberships.isPending} onClick={() => run(() => addMembership(user.id, { groupId }))}>Aan groep toevoegen</button></div>}
  </div></ManagementDialog>
}
