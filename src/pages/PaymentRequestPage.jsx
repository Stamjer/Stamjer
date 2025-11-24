import React, { useMemo, useState } from 'react'
import { withSupportContact } from '../config/appInfo'
import { submitPaymentRequest } from '../services/api'
import './PaymentRequestPage.css'

const MAX_FILES = 3
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB per file
const SUPPORTED_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf'
]

function resolveStoredUser(fallbackUser) {
  if (fallbackUser) {
    return fallbackUser
  }

  try {
    const serialized = localStorage.getItem('user')
    if (serialized) {
      return JSON.parse(serialized)
    }
  } catch {
    localStorage.removeItem('user')
  }

  return null
}

function getInitialFormData(user) {
  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()
  const dateToday = new Date().toISOString().split('T')[0]

  return {
    requesterName: fullName || '',
    requesterEmail: user?.email || '',
    expenseTitle: '',
    paidTo: '',
    expenseDate: dateToday || '',
    amount: '',
    description: '',
    paymentMethod: 'iban',
    iban: '',
    paymentLink: '',
    notes: ''
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export default function PaymentRequestPage({ user: userProp }) {
  const resolvedUser = useMemo(() => resolveStoredUser(userProp), [userProp])
  const [formData, setFormData] = useState(() => getInitialFormData(resolvedUser))
  const [attachments, setAttachments] = useState([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [statusMessage, setStatusMessage] = useState(null)
  const [errorMessage, setErrorMessage] = useState(null)
  const [validationErrors, setValidationErrors] = useState({})

  const handleInputChange = (event) => {
    const { name, value } = event.target
    setFormData((prev) => ({
      ...prev,
      [name]: value
    }))
  }

  const handlePaymentMethodChange = (event) => {
    const method = event.target.value
    setFormData((prev) => ({
      ...prev,
      paymentMethod: method,
      ...(method === 'iban'
        ? { paymentLink: '' }
        : { iban: '' })
    }))
  }

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files || [])
    const newErrors = {}

    const filteredFiles = files.filter((file) => {
      if (!SUPPORTED_TYPES.includes(file.type)) {
        newErrors.file = 'Alleen afbeeldingen (JPG, PNG, WEBP) en PDF-bestanden zijn toegestaan.'
        return false
      }
      if (file.size > MAX_FILE_SIZE) {
        newErrors.file = 'Bestanden mogen maximaal 5MB groot zijn.'
        return false
      }
      return true
    })

    const combined = [...attachments, ...filteredFiles].slice(0, MAX_FILES)
    setAttachments(combined)
    setValidationErrors((prev) => ({
      ...prev,
      ...newErrors
    }))
  }

  const removeAttachment = (index) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  const resetForm = () => {
    setFormData(getInitialFormData(resolvedUser))
    setAttachments([])
    setValidationErrors({})
  }

  const validateForm = () => {
    const errors = {}
    if (!formData.requesterName.trim()) {
      errors.requesterName = 'Naam is verplicht.'
    }
    if (!formData.requesterEmail.trim()) {
      errors.requesterEmail = 'E-mailadres is verplicht.'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.requesterEmail.trim())) {
      errors.requesterEmail = 'Voer een geldig e-mailadres in.'
    }
    if (!formData.expenseTitle.trim()) {
      errors.expenseTitle = 'Een korte omschrijving is verplicht.'
    }
    if (!formData.paidTo.trim()) {
      errors.paidTo = 'Vul in aan wie je hebt betaald.'
    }
    if (!formData.expenseDate) {
      errors.expenseDate = 'Selecteer de datum van de uitgave.'
    }
    if (!formData.description.trim()) {
      errors.description = 'Beschrijf kort wat er is gekocht.'
    }
    if (!formData.amount) {
      errors.amount = 'Het bedrag is verplicht.'
    } else if (Number.isNaN(Number.parseFloat(formData.amount)) || Number(formData.amount) <= 0) {
      errors.amount = 'Voer een geldig bedrag in groter dan 0.'
    }

    if (formData.paymentMethod === 'iban') {
      if (!formData.iban.trim()) {
        errors.iban = 'Vul het IBAN-nummer in.'
      } else {
        const sanitizedIban = formData.iban.replace(/\s+/g, '').toUpperCase()
        // Basic IBAN validation - check format
        if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(sanitizedIban)) {
          errors.iban = 'Een IBAN begint met 2 letters (landcode) en 2 cijfers, gevolgd door je rekeningnummer.'
        } else if (sanitizedIban.startsWith('NL') && sanitizedIban.length !== 18) {
          errors.iban = `Nederlandse IBANs hebben 18 tekens. Dit IBAN heeft ${sanitizedIban.length} tekens.`
        } else if (sanitizedIban.length < 15 || sanitizedIban.length > 34) {
          errors.iban = `Een IBAN heeft tussen de 15 en 34 tekens. Dit IBAN heeft ${sanitizedIban.length} tekens.`
        }
      }
    } else if (formData.paymentMethod === 'paymentLink') {
      if (!formData.paymentLink.trim()) {
        errors.paymentLink = 'Voeg een betaallink toe.'
      } else if (!/^https?:\/\//i.test(formData.paymentLink.trim())) {
        errors.paymentLink = 'Een betaallink moet beginnen met http(s)://'
      }
    }

    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setStatusMessage(null)
    setErrorMessage(null)

    if (!validateForm()) {
      return
    }

    setIsSubmitting(true)

    try {
      const preparedAttachments = await Promise.all(
        attachments.map(async (file) => {
          const dataUrl = await readFileAsDataUrl(file)
          const [, base64Content = ''] = dataUrl.split(',')
          return {
            name: file.name,
            type: file.type,
            size: file.size,
            content: base64Content
          }
        })
      )

      await submitPaymentRequest({
        userId: resolvedUser?.id,
        ...formData,
        amount: Number.parseFloat(formData.amount),
        attachments: preparedAttachments
      })

      setStatusMessage('Je declaratie is verzonden! De penningmeester stuurt een bevestiging zodra de declaratie is goedgekeurd.')
      resetForm()
    } catch (error) {
      console.error('Payment request failed', error)
      setErrorMessage(withSupportContact(error.message || 'Versturen mislukt. Probeer het later opnieuw.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="payment-request-page">
      <header className="payment-request-header">
        <h1>Declaratie indienen</h1>
        <p>
          Heb je voorgeschoten voor de stam?
        </p>
        <p>
          Vul het formulier in en de penningmeester zorgt dat je zo snel mogelijk terugbetaald wordt.
        </p>
      </header>

      <div className="payment-request-content">

        <form className="payment-request-form" onSubmit={handleSubmit} noValidate>
          <div className="payment-request-grid">
            <div className={`form-field${validationErrors.requesterName ? ' has-error' : ''}`}>
              <label htmlFor="requesterName">Naam</label>
              <input
                id="requesterName"
                name="requesterName"
                type="text"
                placeholder="Voor- en achternaam"
                value={formData.requesterName}
                onChange={handleInputChange}
                autoComplete="name"
                required
              />
              {validationErrors.requesterName && <span className="form-error">{validationErrors.requesterName}</span>}
            </div>

            <div className={`form-field${validationErrors.expenseTitle ? ' has-error' : ''}`}>
              <label htmlFor="expenseTitle">Waarvoor heb je betaald?</label>
              <input
                id="expenseTitle"
                name="expenseTitle"
                type="text"
                placeholder="Bijv. opkomst boodschappen"
                value={formData.expenseTitle}
                onChange={handleInputChange}
                required
              />
              {validationErrors.expenseTitle && <span className="form-error">{validationErrors.expenseTitle}</span>}
            </div>

            <div className={`form-field${validationErrors.paidTo ? ' has-error' : ''}`}>
              <label htmlFor="paidTo">Aan wie heb je betaald?</label>
              <input
                id="paidTo"
                name="paidTo"
                type="text"
                placeholder="Bijv. Jumbo"
                value={formData.paidTo}
                onChange={handleInputChange}
                required
              />
              {validationErrors.paidTo && <span className="form-error">{validationErrors.paidTo}</span>}
            </div>

            <div className={`form-field${validationErrors.expenseDate ? ' has-error' : ''}`}>
              <label htmlFor="expenseDate">Datum van betaling</label>
              <input
                id="expenseDate"
                name="expenseDate"
                type="date"
                value={formData.expenseDate}
                onChange={handleInputChange}
                required
              />
              {validationErrors.expenseDate && <span className="form-error">{validationErrors.expenseDate}</span>}
            </div>

            <div className={`form-field${validationErrors.amount ? ' has-error' : ''}`}>
              <label htmlFor="amount">Bedrag</label>
              <div className="amount-input">
                <span aria-hidden="true">€</span>
                <input
                  id="amount"
                  name="amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0,00"
                  value={formData.amount}
                  onChange={handleInputChange}
                  required
                />
              </div>
              {validationErrors.amount && <span className="form-error">{validationErrors.amount}</span>}
            </div>
          </div>

          <div className="form-field">
            <label>Hoe wil je betaald worden?</label>
            <div className="payment-method-options" role="radiogroup" aria-labelledby="payment-method-label">
              <label className="payment-method-option">
                <input
                  type="radio"
                  name="paymentMethod"
                  value="iban"
                  checked={formData.paymentMethod === 'iban'}
                  onChange={handlePaymentMethodChange}
                />
                <span>IBAN</span>
              </label>
              <label className="payment-method-option">
                <input
                  type="radio"
                  name="paymentMethod"
                  value="paymentLink"
                  checked={formData.paymentMethod === 'paymentLink'}
                  onChange={handlePaymentMethodChange}
                />
                <span>Betaalverzoek</span>
              </label>
            </div>
            {formData.paymentMethod === 'iban' && (
              <p className="payment-method-description">
                De penningmeester maakt het binnenkort over naar je rekeningnummer.
              </p>
            )}
            {formData.paymentMethod === 'paymentLink' && (
              <p className="payment-method-description">
                Bijvoorbeeld via een Tikkie.
              </p>
            )}
          </div>

          {formData.paymentMethod === 'iban' && (
            <div className={`form-field${validationErrors.iban ? ' has-error' : ''}`}>
              <label htmlFor="iban">
                IBAN-nummer
                <small>Wordt vertrouwelijk verwerkt en alleen gedeeld met de penningmeester.</small>
              </label>
              <input
                id="iban"
                name="iban"
                type="text"
                inputMode="text"
                placeholder="NL00 BANK 0123 4567 89"
                value={formData.iban}
                onChange={handleInputChange}
                autoComplete="off"
                required
              />
              {validationErrors.iban && <span className="form-error">{validationErrors.iban}</span>}
            </div>
          )}

          {formData.paymentMethod === 'paymentLink' && (
            <div className={`form-field${validationErrors.paymentLink ? ' has-error' : ''}`}>
              <label htmlFor="paymentLink">Link naar je betaalverzoek</label>
              <input
                id="paymentLink"
                name="paymentLink"
                type="url"
                placeholder="https://"
                value={formData.paymentLink}
                onChange={handleInputChange}
                required
              />
              {validationErrors.paymentLink && <span className="form-error">{validationErrors.paymentLink}</span>}
            </div>
          )}

          <div className="form-field">
            <label htmlFor="description">Beschrijf kort wat er is gekocht</label>
            <textarea
              id="description"
              name="description"
              placeholder="Vertel in één of twee zinnen waarvoor dit bedrag bedoeld is."
              value={formData.description}
              onChange={handleInputChange}
              rows={4}
            />
          </div>

          <div className="form-field">
            <label htmlFor="notes">
              Opmerking voor de penningmeester (optioneel)
            </label>
            <textarea
              id="notes"
              name="notes"
              placeholder="Handige extra informatie voor de penningmeester."
              value={formData.notes}
              onChange={handleInputChange}
              rows={3}
            />
          </div>

          <div className={`form-field${validationErrors.file ? ' has-error' : ''}`}>
            <label htmlFor="attachments">
              Voeg bewijs toe
              <small>Bijv. een bonnetje of factuur.</small>
              <small>Maximaal {MAX_FILES} bestanden (tot 5MB per stuk).</small>
              <small>Afbeeldingen of PDFs.</small>
            </label>
            <input
              id="attachments"
              name="attachments"
              type="file"
              accept={SUPPORTED_TYPES.join(',')}
              multiple
              onChange={handleFileChange}
            />
            {validationErrors.file && <span className="form-error">{validationErrors.file}</span>}

            {attachments.length > 0 && (
              <ul className="attachment-list">
                {attachments.map((file, index) => (
                  <li key={`${file.name}-${index}`}>
                    <span>
                      {file.name} <small>({Math.round(file.size / 1024)} KB)</small>
                    </span>
                    <button type="button" onClick={() => removeAttachment(index)}>
                      Verwijderen
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {errorMessage && <div className="form-alert error">{errorMessage}</div>}
          {statusMessage && <div className="form-alert success">{statusMessage}</div>}

          <div className="form-actions">
            <button type="submit" className="primary-btn" disabled={isSubmitting}>
              {isSubmitting ? 'Versturen...' : 'Declaratie versturen'}
            </button>
            {/* <button type="button" className="secondary-btn" onClick={resetForm} disabled={isSubmitting}>
              Alles leegmaken
            </button> */}
          </div>
        </form>
      </div>
    </section>
  )
}
