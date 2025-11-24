import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { NotificationIcon } from '../components/icons'
import {
  useUsers,
  useSendManualNotification,
  useScheduledNotifications,
  useScheduleNotification,
  useUpdateScheduledNotification,
  useCancelScheduledNotification
} from '../hooks/useQueries'
import { formatNotificationMessageMarkup } from '../lib/formatNotificationMessage'
import './NotificationPage.css'

const AUDIENCE_OPTIONS = [
  { value: 'all', label: 'Iedereen' },
  { value: 'admins', label: 'Admins' },
  { value: 'custom', label: 'Specificeer leden' },
]

const PRIORITY_OPTIONS = [
  { value: 'info', label: 'Info' },
  { value: 'normal', label: 'Bericht' },
  { value: 'high', label: 'Belangrijk' },
]

const MESSAGE_TEMPLATES = [
  {
    label: 'Opkomst herinnering',
    title: 'Vergeet je opkomst niet!',
    message: '**Opkomst** start aanstaande zaterdag om 19:30. _Laat even weten_ in de app of je erbij bent.',
  },
  {
    label: 'Declaratie reminder',
    title: 'Declaratie indienen',
    message: 'Heb je recent kosten voorgeschoten? Dien je declaratie uiterlijk [volgende week](https://stamjer.nl/declaraties) in.',
  },
  {
    label: 'Schoonmaakdienst',
    title: 'Schoonmaakploeg aan de beurt',
    message: 'Deze week staan **{ploeg}** ingepland voor de schoonmaak. Neem je sleutel mee en meld bijzonderheden via reply.',
  },
]

const createInitialFormState = () => ({
  title: '',
  message: '',
  audience: 'all',
  recipientIds: [],
  scheduleType: 'now',
  sendAt: '',
  ctaUrl: '',
  attachmentUrl: '',
  priority: 'normal',
  tags: '',
})

const DEFAULT_CHANNELS = ['inApp', 'push', 'email']
const MAX_TITLE_WORDS = 15
const MIN_SCHEDULE_LEAD_MS = 60 * 1000
const DEFAULT_SEND_AHEAD_MS = 5 * 60 * 1000
const DRAFT_STORAGE_KEY = 'notification-admin-draft'

function toLocalDateTimeInputValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function getFutureDateInputValue(offsetMs = DEFAULT_SEND_AHEAD_MS) {
  const safeOffset = Math.max(offsetMs, MIN_SCHEDULE_LEAD_MS)
  return toLocalDateTimeInputValue(new Date(Date.now() + safeOffset))
}

function formatDate(dateString) {
  if (!dateString) {
    return 'Zo snel mogelijk'
  }

  try {
    return new Date(dateString).toLocaleString('nl-NL', {
      dateStyle: 'full',
      timeStyle: 'short'
    })
  } catch (error) {
    return dateString
  }
}

function NotificationAdminPage({ user }) {
  const navigate = useNavigate()
  const messageRef = useRef(null)
  const [formState, setFormState] = useState(() => createInitialFormState())
  const [editingId, setEditingId] = useState(null)
  const [feedback, setFeedback] = useState('')
  const [showPreview, setShowPreview] = useState(true)
  const [draftRestored, setDraftRestored] = useState(false)

  const isAdmin = Boolean(user?.isAdmin)
  const adminId = user?.id
  const sessionToken = useMemo(() => {
    if (user?.sessionToken) return user.sessionToken
    try {
      const raw = localStorage.getItem('user')
      if (raw) {
        const parsed = JSON.parse(raw)
        return parsed?.sessionToken
      }
    } catch {
      return undefined
    }
    return undefined
  }, [user?.sessionToken])

  useEffect(() => {
    if (!adminId || !sessionToken) {
      navigate('/login', { replace: true })
    }
  }, [adminId, sessionToken, navigate])

  const { data: usersResponse = [], isLoading: isUsersLoading } = useUsers({ enabled: isAdmin })
  const {
    data: scheduledResponse = [],
    isFetching: isScheduledFetching,
    error: scheduledError
  } = useScheduledNotifications({
    enabled: isAdmin,
    retry: false,
    sessionToken,
    onError: (error) => {
      if (error?.status === 401) {
        navigate('/login', { replace: true })
      }
    }
  })
  const sendManualMutation = useSendManualNotification()
  const scheduleMutation = useScheduleNotification()
  const updateMutation = useUpdateScheduledNotification()
  const cancelMutation = useCancelScheduledNotification()

  const users = useMemo(() => {
    if (Array.isArray(usersResponse)) return usersResponse
    if (Array.isArray(usersResponse?.users)) return usersResponse.users
    return []
  }, [usersResponse])

  const scheduledNotifications = useMemo(() => {
    if (Array.isArray(scheduledResponse)) return scheduledResponse
    if (Array.isArray(scheduledResponse?.scheduledNotifications)) return scheduledResponse.scheduledNotifications
    if (Array.isArray(scheduledResponse?.items)) return scheduledResponse.items
    return []
  }, [scheduledResponse])

  const recipientNameLookup = useMemo(() => {
    const map = new Map()
    users.forEach((user) => {
      const id = user.id || user._id
      const name = user.firstName || user.email || id
      if (id !== undefined && id !== null) {
        map.set(id, name)
      }
    })
    return map
  }, [users])

  const formatRecipients = (item) => {
    if (item.audience === 'all') return 'Iedereen'
    if (item.audience === 'admins') return 'Admins'
    const ids = Array.isArray(item.recipientIds) ? item.recipientIds : []
    if (ids.length === 0) return 'Geen ontvangers'
    const names = ids.map((id) => recipientNameLookup.get(id) || id)
    return names.join(', ')
  }

  const titleWordCount = useMemo(() => {
    if (!formState.title) return 0
    return formState.title
      .trim()
      .split(/\s+/)
      .filter(Boolean).length
  }, [formState.title])

  const titleWordsRemaining = Math.max(0, MAX_TITLE_WORDS - titleWordCount)
  const minSendAtValue = useMemo(() => getFutureDateInputValue(MIN_SCHEDULE_LEAD_MS), [])

  const recipientSummary = useMemo(() => {
    if (formState.audience === 'all') return 'Alle leden ontvangen deze melding.'
    if (formState.audience === 'admins') return 'Alle admins ontvangen deze melding.'
    if (formState.recipientIds.length === 0) return 'Kies minimaal een ontvanger.'
    return `${formState.recipientIds.length} geselecteerde ontvangers.`
  }, [formState.audience, formState.recipientIds.length])

  const previewMarkup = useMemo(
    () => formatNotificationMessageMarkup(formState.message),
    [formState.message]
  )

  useEffect(() => {
    if (draftRestored) return
    try {
      const stored = localStorage.getItem(DRAFT_STORAGE_KEY)
      if (!stored) return
      const parsed = JSON.parse(stored)
      if (parsed?.formState) {
        setFormState({ ...createInitialFormState(), ...parsed.formState })
      }
      if (parsed?.editingId) {
        setEditingId(parsed.editingId)
      }
    } catch {
      // ignore draft parse errors
    } finally {
      setDraftRestored(true)
    }
  }, [draftRestored])

  useEffect(() => {
    const hasContent =
      formState.title.trim() ||
      formState.message.trim() ||
      formState.ctaUrl.trim() ||
      formState.attachmentUrl.trim() ||
      formState.scheduleType === 'schedule' ||
      (formState.audience === 'custom' && formState.recipientIds.length > 0)

    if (!hasContent) {
      localStorage.removeItem(DRAFT_STORAGE_KEY)
      return
    }

    const payload = JSON.stringify({ formState, editingId })
    localStorage.setItem(DRAFT_STORAGE_KEY, payload)
  }, [formState, editingId])

  const isSaving =
    sendManualMutation.isLoading ||
    scheduleMutation.isLoading ||
    updateMutation.isLoading

  if (!isAdmin) {
    return (
      <section className="notification-page" aria-labelledby="notification-admin-title">
        <div className="notification-panel">
          <div className="notification-page__title">
            <span className="notification-page__icon" aria-hidden="true">
              <NotificationIcon />
            </span>
            <div>
              <h1 id="notification-admin-title">Geen toegang</h1>
              <p className="notification-panel__subtitle">
                Alleen admins kunnen meldingen beheren.
              </p>
            </div>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/meldingen')}>
            Terug naar meldingen
          </button>
        </div>
      </section>
    )
  }

  const resetForm = () => {
    setFormState(createInitialFormState())
    setEditingId(null)
    setFeedback('')
    localStorage.removeItem(DRAFT_STORAGE_KEY)
  }

  const handleInputChange = (event) => {
    const { name, value, type, checked } = event.target

    if (name === 'title') {
      const words = value.trim().split(/\s+/).filter(Boolean)
      const limited = words.slice(0, MAX_TITLE_WORDS).join(' ')
      const nextTitle = words.length > MAX_TITLE_WORDS ? limited : value
      setFormState((prev) => ({
        ...prev,
        title: nextTitle
      }))
      return
    }

    if (name === 'scheduleType') {
      if (value === 'schedule' && !formState.sendAt) {
        setFormState((prev) => ({
          ...prev,
          scheduleType: value,
          sendAt: getFutureDateInputValue()
        }))
        return
      }
      if (value === 'now') {
        setFormState((prev) => ({
          ...prev,
          scheduleType: value,
          sendAt: ''
        }))
        return
      }
    }

    setFormState((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }))
  }

  const handleAudienceChange = (event) => {
    const { value } = event.target
    setFormState((prev) => ({
      ...prev,
      audience: value,
      recipientIds: value === 'custom' ? prev.recipientIds : []
    }))
  }

  const handleRecipientToggle = (id) => {
    setFormState((prev) => {
      const exists = prev.recipientIds.includes(id)
      const nextIds = exists
        ? prev.recipientIds.filter((recipientId) => recipientId !== id)
        : [...prev.recipientIds, id]
      return { ...prev, recipientIds: nextIds }
    })
  }

  const applyFormatting = (format) => {
    const textarea = messageRef.current
    if (!textarea) return

    const { selectionStart, selectionEnd, value } = textarea
    const selectedText = value.slice(selectionStart, selectionEnd)

    const insertText = (text, caretOffset = text.length) => {
      const newMessage = value.slice(0, selectionStart) + text + value.slice(selectionEnd)
      setFormState((prev) => ({
        ...prev,
        message: newMessage
      }))

      requestAnimationFrame(() => {
        textarea.focus()
        const cursorPosition = selectionStart + caretOffset
        textarea.setSelectionRange(cursorPosition, cursorPosition)
      })
    }

    if (format === 'bold') {
      const wrapped = `**${selectedText || 'vetgedrukte tekst'}**`
      insertText(wrapped)
      return
    }

    if (format === 'italic') {
      const wrapped = `_${selectedText || 'schuingedrukte tekst'}_`
      insertText(wrapped)
      return
    }

    if (format === 'link') {
      const url = window.prompt('Welke URL wil je toevoegen?', 'https://')
      if (!url) return
      const wrapped = `[${selectedText || 'linktekst'}](${url})`
      insertText(wrapped, wrapped.length)
      return
    }

    if (format === 'list') {
      const block = selectedText || 'Punt 1\n- Punt 2'
      const lines = block.split('\n').map((line) => {
        const trimmed = line.trim()
        return trimmed.startsWith('- ') ? trimmed : `- ${trimmed || 'Nieuw punt'}`
      })
      const wrapped = lines.join('\n')
      insertText(wrapped)
    }
  }

  const handleApplyTemplate = (template) => {
    setFormState((prev) => ({
      ...prev,
      title: prev.title || template.title,
      message: prev.message ? `${prev.message}\n\n${template.message}` : template.message
    }))
  }

  const buildPayload = () => {
    const trimmedTitle = formState.title.trim()
    const trimmedMessage = formState.message.trim()
    const trimmedCtaUrl = formState.ctaUrl.trim()

    return {
      title: trimmedTitle,
      message: trimmedMessage,
      audience: formState.audience,
      recipientIds: formState.audience === 'custom' ? formState.recipientIds : [],
      channels: DEFAULT_CHANNELS,
      cta: trimmedCtaUrl ? { url: trimmedCtaUrl } : undefined,
      attachments: formState.attachmentUrl ? [{ url: formState.attachmentUrl }] : undefined,
      priority: formState.priority,
      createdBy: adminId,
    }
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    setFeedback('')

    if (!adminId || !sessionToken) {
      navigate('/login', { replace: true })
      return
    }

    if (!adminId) {
      setFeedback('Je bent niet ingelogd als admin.')
      return
    }

    if (!formState.title.trim()) {
      setFeedback('Een titel is verplicht.')
      return
    }

    if (!formState.message.trim()) {
      setFeedback('Schrijf eerst een bericht voordat je het verstuurt.')
      return
    }

    if (formState.audience === 'custom' && formState.recipientIds.length === 0) {
      setFeedback('Selecteer minstens een ontvanger voor aangepaste meldingen.')
      return
    }

    if (titleWordCount > MAX_TITLE_WORDS) {
      setFeedback(`Gebruik maximaal ${MAX_TITLE_WORDS} woorden in de titel.`)
      return
    }

    const payload = buildPayload()

    if (formState.scheduleType === 'now' && !editingId) {
      sendManualMutation.mutate(
        { userId: adminId, payload, sessionToken },
        {
          onSuccess: () => {
            setFeedback('Melding succesvol verstuurd.')
            resetForm()
          },
          onError: (error) => {
            if (error?.status === 401) {
              navigate('/login', { replace: true })
              return
            }
            setFeedback(error.message || 'Versturen is mislukt.')
          }
        }
      )
      return
    }

    if (!formState.sendAt) {
      setFeedback('Kies een datum en tijd om de melding in te plannen.')
      return
    }

    const sendAtDate = new Date(formState.sendAt)
    if (Number.isNaN(sendAtDate.getTime())) {
      setFeedback('Kies een geldige datum en tijd.')
      return
    }

    if (sendAtDate.getTime() <= Date.now() + MIN_SCHEDULE_LEAD_MS) {
      setFeedback('Plan meldingen minimaal 1 minuut in de toekomst.')
      return
    }

    const schedulePayload = {
      ...payload,
      sendAt: new Date(formState.sendAt).toISOString(),
      status: 'scheduled',
    }

    if (editingId) {
      updateMutation.mutate(
        { notificationId: editingId, payload: schedulePayload, sessionToken },
        {
          onSuccess: () => {
            setFeedback('Geplande melding bijgewerkt.')
            resetForm()
          },
          onError: (error) => {
            if (error?.status === 401) {
              navigate('/login', { replace: true })
              return
            }
            setFeedback(error.message || 'Bijwerken is mislukt.')
          }
        }
      )
    } else {
      scheduleMutation.mutate(
        { payload: schedulePayload, sessionToken },
        {
          onSuccess: () => {
            setFeedback('Melding ingepland.')
            resetForm()
          },
          onError: (error) => {
            if (error?.status === 401) {
              navigate('/login', { replace: true })
              return
            }
            setFeedback(error.message || 'Inplannen is mislukt.')
          }
        }
      )
    }
  }

  const handleEditScheduled = (scheduled) => {
    setEditingId(scheduled.id)
    const sendAtDate = scheduled.sendAt ? new Date(scheduled.sendAt) : null
    const isFutureSendAt = sendAtDate && sendAtDate.getTime() > Date.now()
    const resolvedSendAt = isFutureSendAt ? sendAtDate : new Date(Date.now() + DEFAULT_SEND_AHEAD_MS)
    setFormState((prev) => ({
      ...prev,
      title: scheduled.title || '',
      message: scheduled.message || '',
      audience: scheduled.audience || 'all',
      recipientIds: scheduled.recipientIds || [],
      scheduleType: 'schedule',
      sendAt: resolvedSendAt ? toLocalDateTimeInputValue(resolvedSendAt) : '',
      // Channels stay user-based; keep default list to satisfy backend expectations
      channels: DEFAULT_CHANNELS.reduce((acc, channel) => ({ ...acc, [channel]: true }), {}),
      ctaUrl: scheduled.cta?.url || '',
      attachmentUrl: scheduled.attachments?.[0]?.url || '',
      priority: scheduled.priority || 'normal',
    }))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleCancelScheduled = (scheduled) => {
    if (!scheduled?.id) return
    const confirmed = window.confirm(`Weet je zeker dat je "${scheduled.title}" wilt annuleren?`)
    if (!confirmed) return

    cancelMutation.mutate(
      { notificationId: scheduled.id, sessionToken },
      {
        onSuccess: () => {
          setFeedback('Geplande melding geannuleerd.')
          if (editingId === scheduled.id) {
            resetForm()
          }
        },
        onError: (error) => {
          if (error?.status === 401) {
            navigate('/login', { replace: true })
            return
          }
          setFeedback(error.message || 'Annuleren is mislukt.')
        }
      }
    )
  }

  return (
    <section className="notification-page" aria-labelledby="notification-admin-title">
      <div className="notification-admin__grid">
        <form
          id="notification-admin-form"
      className="notification-panel notification-admin__form"
      onSubmit={handleSubmit}
    >
      <div className="notification-admin__header">
        <div>
          <h2>{editingId ? 'Geplande melding aanpassen' : 'Nieuwe melding'}</h2>
        </div>
        <div className="notification-admin__status">
          <label className="notification-form__label">Verzendmoment</label>
          <div className="notification-admin__choices">
            <label className={formState.scheduleType === 'now' ? 'is-active' : ''}>
                  <input
                    type="radio"
                    name="scheduleType"
                    value="now"
                    checked={formState.scheduleType === 'now'}
                    onChange={handleInputChange}
                    disabled={Boolean(editingId)}
                  />
                  Direct
                </label>
                <label className={formState.scheduleType === 'schedule' ? 'is-active' : ''}>
                  <input
                    type="radio"
                    name="scheduleType"
                    value="schedule"
                    checked={formState.scheduleType === 'schedule'}
                    onChange={handleInputChange}
                  />
                  Inplannen
                </label>
              </div>
            </div>
          </div>

          <div className="notification-form__group">
            <label htmlFor="title">Titel</label>
            <input
              id="title"
              name="title"
              type="text"
              value={formState.title}
              onChange={handleInputChange}
              placeholder="Reminder"
            />
            <p className={`field-hint ${titleWordsRemaining === 0 ? 'field-hint--warning' : ''}`}>
              Maximaal {MAX_TITLE_WORDS} woorden.
            </p>
          </div>

          <div className="notification-form__group">
            <div className="notification-form__group-header">
              <label htmlFor="message">Bericht</label>
            </div>
            <textarea
              id="message"
              name="message"
              ref={messageRef}
              value={formState.message}
              onChange={handleInputChange}
              placeholder="De opkomst vrijdag begint om 20:00 komende vrijdag!"
            />
          </div>
          <div className="notification-form__row">
            <div className="notification-form__group">
              <label htmlFor="audience">Doelgroep</label>
              <select id="audience" name="audience" value={formState.audience} onChange={handleAudienceChange}>
                {AUDIENCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            {formState.audience === 'custom' && (
              <div className="notification-form__group notification-recipients">
                <div className="notification-form__group-header">
                  <div>
                    <label>Ontvangers selecteren</label>
                    <p className="notification-panel__subtitle">Vink de personen aan die dit bericht moeten ontvangen.</p>
                  </div>
                  <span className="notification-recipient__count">{formState.recipientIds.length} geselecteerd</span>
                </div>
                <div className="notification-recipients__grid">
                  {isUsersLoading && <p>Gebruikers worden geladen...</p>}
                  {!isUsersLoading && users.map((person) => {
                    const id = person.id || person._id || person.email
                    return (
                      <label key={id} className="notification-recipient__item">
                        <input
                          type="checkbox"
                          value={id}
                          checked={formState.recipientIds.includes(id)}
                          onChange={() => handleRecipientToggle(id)}
                        />
                        <span>{person.firstName || person.name || person.email}</span>
                      </label>
                    )
                  })}
                </div>
                {formState.recipientIds.length === 0 && (
                  <p className="notification-panel__subtitle">Selecteer minstens een ontvanger.</p>
                )}
              </div>
            )}

          
            <div className="notification-form__group">
              <label htmlFor="priority">Prioriteit</label>
              <select id="priority" name="priority" value={formState.priority} onChange={handleInputChange}>
                {PRIORITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>

          {formState.scheduleType === 'schedule' && (
            <div className="notification-form__group">
              <label htmlFor="sendAt">Verzenddatum en tijd</label>
              <input
                id="sendAt"
                name="sendAt"
                type="datetime-local"
                value={formState.sendAt}
                onChange={handleInputChange}
                min={minSendAtValue}
              />
            </div>
          )}

          <div className="notification-form__group">
            <label htmlFor="ctaUrl">Link (optioneel)</label>
            <input
              id="ctaUrl"
              name="ctaUrl"
              type="url"
              value={formState.ctaUrl}
              onChange={handleInputChange}
              placeholder="https://"
            />
          </div>

          <div className="notification-form__group">
            <label htmlFor="attachmentUrl">Bijlage (link)</label>
            <input
              id="attachmentUrl"
              name="attachmentUrl"
              type="url"
              value={formState.attachmentUrl}
              onChange={handleInputChange}
              placeholder="https://drive.google.com/..."
            />
          </div>
        </form>

        {showPreview && (
          <div className="notification-panel notification-preview-card">
            <h3>Preview</h3>
            <div className="notification-preview">
              <div className="notification-preview__email-card">
                <div className="notification-preview__subject-row">
                  <span className={`notification-preview__badge notification-preview__badge--${formState.priority}`}>
                    {PRIORITY_OPTIONS.find((option) => option.value === formState.priority)?.label || 'Prioriteit'}
                  </span>
                </div>
                <div className="notification-preview__subject-row">
                  <p className="notification-preview__subject">{formState.title || 'Nog geen titel'}</p>
                </div>
                <div className="notification-preview__body" dangerouslySetInnerHTML={previewMarkup} />
                {formState.ctaUrl && (
                  <a href={formState.ctaUrl} className="btn btn-primary" target="_blank" rel="noopener noreferrer">
                    Open link
                  </a>
                )}
                {formState.attachmentUrl && (
                  <a href={formState.attachmentUrl} target="_blank" rel="noopener noreferrer" className="notification-preview__attachment">
                    Bijlage openen
                  </a>
                )}
              </div>
              <div className="notification-preview__meta">
                <span>{recipientSummary}</span>
                {formState.scheduleType === 'schedule' && formState.sendAt && (
                  <span>Verzending: {formatDate(formState.sendAt)}</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="notification-panel">
        {feedback && (
          <p className="notification-status message">{feedback}</p>
        )}
        <button form="notification-admin-form" type="submit" className="btn btn-primary" disabled={isSaving}>
          {editingId
            ? 'Planning opslaan'
            : formState.scheduleType === 'schedule'
              ? 'Melding inplannen'
              : 'Nu versturen'}
        </button>
        <button
          type="button"
          className="btn btn-outline notification-reset-btn"
          onClick={resetForm}
          disabled={isSaving}
        >
          Leeg formulier
        </button>
      </div>

      <div className="notification-panel notification-admin__scheduled">
        <div className="notification-admin__header">
          <div>
            <h2>Geplande meldingen</h2>
          </div>
          {isScheduledFetching && <span className="notification-status">Bezig met laden...</span>}
        </div>
        {scheduledError && (
          <div className="notification-status error">
            Geplande meldingen konden niet worden geladen ({scheduledError.message || 'onbekende fout'}).
          </div>
        )}

        {scheduledNotifications.length === 0 ? (
          <div className="notification-empty" role="status">
            Er staan momenteel geen meldingen gepland.
          </div>
        ) : (
          <div className="scheduled-list">
            {scheduledNotifications.map((item) => (
              <article key={item.id || item._id} className="scheduled-item">
                <div className="scheduled-item__header">
                  <div>
                    <h3>{item.title}</h3>
                    <p>{formatDate(item.sendAt)}</p>
                  </div>
                  <span className={`notification-preview__badge notification-preview__badge--${item.priority || 'normal'}`}>
                    {item.status || 'Gepland'}
                  </span>
                </div>
                <div
                  className="scheduled-item__message"
                  dangerouslySetInnerHTML={formatNotificationMessageMarkup(item.message || '')}
                />
                <div className="scheduled-item__meta">
                  <span>Ontvangers: {formatRecipients(item)}</span>
                </div>
                <div className="scheduled-item__actions">
                  <button type="button" className="btn btn-secondary" onClick={() => handleEditScheduled(item)}>
                    Bewerken
                  </button>
                  <button type="button" className="btn notification-reset-btn" style={{ margin: 'auto' }} onClick={() => handleCancelScheduled(item)} disabled={cancelMutation.isLoading}>
                    Annuleren
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

export default NotificationAdminPage
