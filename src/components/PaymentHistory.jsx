import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPaymentHistory, downloadPaymentReceipt, retryPaymentRequest } from '../services/api'

const STATUS = { stored: 'Opgeslagen; nog niet verzonden', sending: 'Verzending gestart; uitkomst nog niet bevestigd', 'smtp-accepted': 'E-mail geaccepteerd door mailserver', 'delivery-failed': 'E-mail geweigerd', 'delivery-unknown': 'E-mailstatus onzeker; neem contact op voordat je opnieuw indient' }
export default function PaymentHistory({ user }) {
  const [error, setError] = useState('')
  const history = useQuery({ queryKey: ['payment-history', user.id, user.groupId], queryFn: getPaymentHistory, refetchInterval: 15000 })
  const groupName = user.memberships?.find(m => m.groupId === user.groupId)?.group.name || user.groupId
  return <section aria-label="Declaratiehistorie"><h2>Mijn declaraties · {groupName}</h2>
    <p>Hier staan aanvragen die sinds de invoering van deze historie zijn opgeslagen. Eerdere aanvragen die alleen per e-mail zijn verstuurd, staan hier niet.</p>
    {history.isLoading && <p>Historie laden…</p>}
    {(history.error || error) && <p role="alert">{history.error?.message || error}</p>}
    {history.data?.declarations?.length === 0 && <p>Nog geen opgeslagen declaraties voor deze groep.</p>}
    {history.data?.declarations?.map(record => <details key={record.id}>
      <summary>{new Date(record.submittedAt).toLocaleDateString('nl-NL')} · {record.form.expenseTitle} · {Number(record.form.amount).toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' })}</summary>
      <p>{STATUS[record.status] || 'Verzendstatus niet bekend'}</p>
      {record.status === 'stored' && user.membershipState !== 'ended' && <button type="button" onClick={async () => { try { await retryPaymentRequest(record.id); await history.refetch() } catch (failure) { setError(failure.message) } }}>Opgeslagen declaratie verzenden</button>}
      <dl>{Object.entries(record.form).map(([key, value]) => <React.Fragment key={key}><dt>{{ requesterName: 'Naam', requesterEmail: 'E-mail', paidTo: 'Betaald aan', expenseTitle: 'Doel', expenseDate: 'Datum uitgave', amount: 'Bedrag', description: 'Beschrijving', notes: 'Opmerking', paymentMethod: 'Betaalmethode', iban: 'IBAN', paymentLink: 'Betaallink' }[key] || key}</dt><dd>{String(value || '—')}</dd></React.Fragment>)}</dl>
      {record.attachments.map(file => <button type="button" key={file.id} onClick={async () => { try { await downloadPaymentReceipt(record.id, file) } catch (failure) { setError(failure.message) } }}>{file.name} downloaden</button>)}
    </details>)}
  </section>
}
