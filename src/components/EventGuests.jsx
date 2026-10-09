import React from 'react'
import { MAX_EVENT_GUESTS, MAX_GUEST_NAME_LENGTH } from '../../shared/eventGuests'
import './EventGuests.css'

export default function EventGuests({ names = [], onChange, disabled = false, error }) {
  return <div className="event-guests">
    {Array.from({ length: Math.min(names.length + 1, MAX_EVENT_GUESTS) }, (_, index) => {
      const selected = index < names.length
      const label = index === 0 ? 'Gast' : `Gast ${index + 1}`
      return <div className="event-guest-row" key={index}>
        <label className="checkbox-label event-guest-toggle">
          <input type="checkbox" className="checkbox-input" checked={selected} disabled={disabled}
            onChange={event => onChange(event.target.checked ? [...names, ''] : names.filter((_, i) => i !== index))} />
          <span className="checkbox-custom" aria-hidden="true"></span>
          <em>{label}</em>
        </label>
        {selected && <input className="form-input form-input-compact event-guest-name" type="text" value={names[index]} placeholder="Naam"
          aria-label={`Naam ${label.toLowerCase()}`} required autoFocus maxLength={MAX_GUEST_NAME_LENGTH}
          disabled={disabled} onChange={event => onChange(names.map((value, i) => i === index ? event.target.value : value))} />}
      </div>
    })}
    {error && <p className="field-error" role="alert">{error}</p>}
  </div>
}
