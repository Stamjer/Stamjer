import React, { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { moveUserGroup, previewUserGroupMove } from '../services/api'
import { queryKeys } from '../lib/queryClient'
import { USER_STATUS_LABELS } from '../lib/userManagement'
import ManagementDialog from './ManagementDialog'

export default function UserGroupMoveDialog({ user, groups, onClose, onMoved }) {
  const queryClient = useQueryClient()
  const [destination, setDestination] = useState('')
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const previewMutation = useMutation({
    mutationFn: () => previewUserGroupMove(user.id, destination),
    onSuccess: data => { setPreview(data); setError('') },
    onError: failure => setError(failure.message)
  })
  const moveMutation = useMutation({
    mutationFn: () => moveUserGroup(user.id, destination, preview.previewToken),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.users.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.events.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.developer.all })
      ])
      onMoved('Gebruiker verplaatst. De gebruiker moet opnieuw inloggen; oude groepshistorie is bewaard.')
      onClose()
    },
    onError: failure => { setError(failure.message); setPreview(null) }
  })
  const busy = previewMutation.isPending || moveMutation.isPending
  const groupName = id => groups.find(group => group.id === id)?.name || id
  return <ManagementDialog title="Gebruiker verplaatsen" busy={busy} onClose={onClose}>
    <form className="management-form" onSubmit={event => { event.preventDefault(); if (preview) moveMutation.mutate(); else previewMutation.mutate() }}>
      <p>{user.firstName} {user.lastName} · {groupName(user.groupId)}</p>
      <label>Bestemmingsgroep<select className="form-select" autoFocus required value={destination} disabled={busy} onChange={event => { setDestination(event.target.value); setPreview(null); setError('') }}>
        <option value="">Kies een groep</option>{groups.filter(group => group.status === 'active' && group.id !== user.groupId).map(group => <option key={group.id} value={group.id}>{group.name || group.id}</option>)}
      </select></label>
      <p>De oude groep bewaart aanwezigheid, taken en streepjes in het groepsarchief. De gebruiker begint in de nieuwe groep met 0 streepjes en moet opnieuw inloggen.</p>
      {preview && <div className="management-move-preview" role="status">
        <p>Van {groupName(preview.summary.sourceGroupId)} naar {groupName(preview.summary.destinationGroupId)}.</p>
        <ul><li>{preview.summary.archivedEvents} gekoppelde evenementen en {preview.summary.archivedStreepjes} streepjes worden gearchiveerd.</li>
          <li>{preview.summary.futureAssignments} toekomstige taakindelingen vervallen in de oude groep.</li>
          <li>Aanmelden voor {preview.summary.destinationOpkomsten} toekomstige opkomsten in de nieuwe groep.</li>
          <li>Status blijft {USER_STATUS_LABELS[preview.summary.status]?.toLowerCase()}; rol wordt Gebruiker{preview.summary.previousRole === 'admin' ? ' (beheerrechten vervallen)' : ''}.</li>
        </ul><p>Controleer deze gevolgen en bevestig de verplaatsing.</p>
      </div>}
      {error && <p role="alert" className="management-error">{error}</p>}
      <div className="management-form-actions"><button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>Annuleren</button>
        <button className="btn btn-primary" disabled={busy || !destination}>{busy ? 'Bezig…' : preview ? 'Verplaatsing bevestigen' : 'Gevolgen bekijken'}</button>
      </div>
    </form>
  </ManagementDialog>
}
