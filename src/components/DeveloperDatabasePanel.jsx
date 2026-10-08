import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { applyDatabaseEdit, getDatabaseRecords, previewDatabaseEdit } from '../services/api'
import { queryKeys } from '../lib/queryClient'
import ManagementDialog from './ManagementDialog'

function RecordEditor({ collection, item, onClose }) {
  const queryClient = useQueryClient()
  const [text, setText] = useState(JSON.stringify(item.editable, null, 2))
  const [preview, setPreview] = useState(null)
  const id = item.record.id
  const review = useMutation({ mutationFn: () => previewDatabaseEdit(collection, id, JSON.parse(text)), onSuccess: result => setPreview(result) })
  const save = useMutation({ mutationFn: () => applyDatabaseEdit(collection, id, JSON.parse(text), preview.previewToken),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.developer.all }), queryClient.invalidateQueries({ queryKey: queryKeys.users.all }), queryClient.invalidateQueries({ queryKey: queryKeys.events.all })])
      onClose()
    } })
  const busy = review.isPending || save.isPending
  return <ManagementDialog title="Record bewerken" onClose={onClose} busy={busy}><div className="management-form">
    <p>{collection} · {id}</p>
    {!preview ? <><label>Wijzigingen (JSON)<textarea className="developer-json" rows={16} value={text} onChange={event => { setText(event.target.value); review.reset() }} autoFocus spellCheck={false} /></label><p>Alleen de getoonde velden zijn bewerkbaar. Een wijziging wordt eerst gecontroleerd.</p></> : <><p>Controleer de wijziging voordat je deze opslaat.</p><ul>{preview.changedFields.map(field => <li key={field}><strong>{field}</strong><pre className="developer-json">{JSON.stringify(preview.before[field], null, 2)}{'\n→\n'}{JSON.stringify(preview.after[field], null, 2)}</pre></li>)}</ul></>}
    {(review.error || save.error) && <p role="alert" className="management-error">{(review.error || save.error).message}</p>}
    <div className="management-form-actions"><button className="btn btn-secondary" disabled={busy} onClick={onClose}>Annuleren</button>{preview ? <><button className="btn btn-secondary" disabled={busy} onClick={() => { setPreview(null); save.reset() }}>Terug</button><button className="btn btn-primary" disabled={busy} onClick={() => save.mutate()}>Wijziging bevestigen</button></> : <button className="btn btn-primary" disabled={busy} onClick={() => review.mutate()}>Wijziging bekijken</button>}</div>
  </div></ManagementDialog>
}

export default function DeveloperDatabasePanel({ scope, audit = false }) {
  const [collection, setCollection] = useState(audit ? 'auditLogs' : 'users')
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState({ action: '', actorId: '' })
  const [editing, setEditing] = useState(null)
  const records = useQuery({ queryKey: [...queryKeys.developer.all, 'database', collection, scope, page, filters], queryFn: () => getDatabaseRecords(collection, scope, { page, ...filters }), staleTime: 0, refetchInterval: 15000 })
  return <section className="developer-database"><h2>{audit ? 'Audit' : 'Database'}</h2>
    <div className="management-toolbar">{!audit && <label>Collectie<select value={collection} onChange={event => { setCollection(event.target.value); setPage(1) }}>{['users', 'events', 'groups', 'groupMemberships', 'groupMembershipHistory', 'userGroupHistory', 'auditLogs', 'sessions', 'resetCodes'].map(name => <option key={name}>{name}</option>)}</select></label>}
      {collection === 'auditLogs' && <><label>Actie<input value={filters.action} placeholder="Bijvoorbeeld user-updated" onChange={event => { setFilters(current => ({ ...current, action: event.target.value })); setPage(1) }} /></label><label>Actor-ID<input type="number" min={1} value={filters.actorId} onChange={event => { setFilters(current => ({ ...current, actorId: event.target.value })); setPage(1) }} /></label></>}
    </div>
    {records.error && <p role="alert" className="management-error">{records.error.message}</p>}
    {records.isPending ? <p role="status">Records laden…</p> : <><p>{records.data?.total || 0} records · Pagina {page} van {records.data?.pages || 1}</p>
      <div className="developer-records">{records.data?.records.map((item, index) => <details key={item.record.id || item.record.sessionId || item.record.email || index}><summary>{item.record.action || item.record.title || item.record.name || [item.record.firstName, item.record.lastName].filter(Boolean).join(' ') || item.record.email || 'Sessie'} · {item.record.id || item.record.userId || ''}{item.record.timestamp ? ` · ${new Date(item.record.timestamp).toLocaleString('nl-NL')}` : ''}</summary>
        <pre className="developer-json">{JSON.stringify(item.record, null, 2)}</pre>{item.editable && <button className="btn btn-secondary" onClick={() => setEditing(item)}>JSON bewerken</button>}
      </details>)}</div><div className="developer-card-actions"><button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage(current => current - 1)}>Vorige</button><button className="btn btn-secondary" disabled={page >= (records.data?.pages || 1)} onClick={() => setPage(current => current + 1)}>Volgende</button></div></>}
    {editing && <RecordEditor collection={collection} item={editing} onClose={() => setEditing(null)} />}
  </section>
}
