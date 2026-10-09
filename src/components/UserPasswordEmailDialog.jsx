import React, { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { sendUserPasswordEmail } from '../services/api'
import { queryKeys } from '../lib/queryClient'
import ManagementDialog from './ManagementDialog'

export default function UserPasswordEmailDialog({ user, onClose, onSent }) {
  const [purpose, setPurpose] = useState('reset')
  const queryClient = useQueryClient()
  const send = useMutation({ mutationFn: () => sendUserPasswordEmail(user.id, purpose, user.groupId), onSuccess: result => {
    onSent(result.msg)
    queryClient.invalidateQueries({ queryKey: queryKeys.developer.all })
    onClose()
  } })
  return <ManagementDialog title="Wachtwoord-e-mail versturen" busy={send.isPending} onClose={onClose}><div className="management-form">
    <p>Stuur {user.firstName} {user.lastName} een code op {user.email}. De code is 15 minuten geldig.</p>
    <label>Bericht<select className="form-select" value={purpose} onChange={event => setPurpose(event.target.value)}><option value="reset">Wachtwoordherstel</option><option value="invite">Uitnodiging voor nieuw account</option></select></label>
    <p>De gebruiker stelt zelf een wachtwoord in. Het huidige wachtwoord blijft geldig tot de code wordt gebruikt.</p>
    {send.error && <p role="alert" className="management-error">{send.error.message}</p>}
    <div className="management-form-actions"><button className="btn btn-secondary" disabled={send.isPending} onClick={onClose}>Annuleren</button><button className="btn btn-primary" disabled={send.isPending} onClick={() => send.mutate()}>E-mail versturen</button></div>
  </div></ManagementDialog>
}
