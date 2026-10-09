import React from 'react'
import './DeveloperEventMembers.css'
import { useQuery } from '@tanstack/react-query'
import { getUsersFull } from '../services/api'
import { queryKeys } from '../lib/queryClient'
import EventGuests from './EventGuests'

export default function DeveloperEventMembers({ form, setForm, event, groupId }) {
  const members = useQuery({ queryKey: queryKeys.developer.users(groupId), queryFn: () => getUsersFull(groupId), staleTime: 0 })
  const users = members.data?.users || []
  const membershipMode = users.some(user => user.membershipId)
  const future = new Date(form.start) > new Date()
  const historical = membershipMode && event && new Date(event.start) <= new Date()
  const toggle = (field, id, checked) => setForm(current => ({ ...current, [field]: checked ? [...new Set([...current[field], id])] : current[field].filter(value => value !== id) }))
  return <div className="developer-event-members">
    {members.isPending && <p role="status">Groepsleden laden…</p>}
    {members.error && <p role="alert" className="management-error">{members.error.message}</p>}
    {[['participants', 'Aangemelde deelnemers'], ['opkomstmakerIds', 'Opkomstmakers'], ['schoonmakerIds', 'Schoonmakers']].map(([field, label]) => <fieldset key={field}><legend>{label}</legend>
      {field === 'participants' && !event && form.isOpkomst && <p>Alle actieve leden worden bij een nieuwe opkomst automatisch aangemeld.</p>}
      {users.map(user => {
        const automatic = field === 'participants' && !event && form.isOpkomst && user.status === 'active'
        const checked = automatic || form[field].includes(user.id)
        const eligible = (!user.membershipState || user.membershipState === 'current') && (field === 'participants' ? user.status !== 'legacy' : user.status === 'active')
        return <label className="management-checkbox" key={user.id}><input type="checkbox" checked={checked} disabled={historical || automatic || (!eligible && !checked)} onChange={change => toggle(field, user.id, change.target.checked)} />{user.firstName} {user.lastName}{user.status !== 'active' ? ` (${user.status})` : ''}</label>
      })}
      {field === 'opkomstmakerIds' && form.isOpkomst && <EventGuests names={form.guestOpkomstmakers} disabled={historical} onChange={names => setForm(current => ({ ...current, guestOpkomstmakers: names }))} />}
      {field !== 'participants' && (event?.[field === 'opkomstmakerIds' ? 'legacyOpkomstmakerNames' : 'legacySchoonmakerNames'] || []).length > 0 && <p>Historische namen: {event[field === 'opkomstmakerIds' ? 'legacyOpkomstmakerNames' : 'legacySchoonmakerNames'].join(', ')}</p>}
    </fieldset>)}
    <fieldset><legend>Werkelijke aanwezigheid</legend><p>Standaard volgt de aanmelding. Een afwijking levert bij een opkomst één streepje op.</p>
      {users.map(user => {
        const value = Object.hasOwn(form.attendance, user.id) ? String(form.attendance[user.id]) : ''
        const participant = form.participants.includes(user.id) || (!event && form.isOpkomst && user.status === 'active')
        const stripe = form.isOpkomst && value !== '' && participant !== (value === 'true')
        return <label key={user.id}>{user.firstName} {user.lastName}{stripe ? ' · 1 streepje' : ''}<select className="form-select" disabled={membershipMode && future} value={value} onChange={change => setForm(current => {
          const attendance = { ...current.attendance }
          if (change.target.value === '') delete attendance[user.id]
          else attendance[user.id] = change.target.value === 'true'
          return { ...current, attendance }
        })}><option value="">Standaard ({participant ? 'aanwezig' : 'afwezig'})</option><option value="true">Aanwezig</option><option value="false">Afwezig</option></select></label>
      })}
    </fieldset>
    <label>Schoonmaakopties (één per regel)<textarea className="form-textarea" rows={3} value={form.schoonmaakOptions.join('\n')} onChange={change => setForm(current => ({ ...current, schoonmaakOptions: change.target.value.split('\n') }))} /></label>
  </div>
}
