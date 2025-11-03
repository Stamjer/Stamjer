/**
 * ================================================================
 * CALENDAR SUBSCRIPTION COMPONENT
 * ================================================================
 * 
 * Simple, professional component for subscribing to calendar feed.
 * Provides easy access to iCalendar URL for external calendar apps.
 * 
 * Features:
 * - Copy URL to clipboard
 * - Instructions for popular calendar apps
 * - Clean, elegant design
 * 
 * @author R.S. Kort
 * @version 1.0.0
 */

import React, { useState } from 'react'
import './CalendarSubscription.css'

// Toggle this to show/hide for all users
const ADMIN_ONLY = false

export default function CalendarSubscription({ user }) {
  const [copied, setCopied] = useState(false)
  const [showInstructions, setShowInstructions] = useState(false)
  
  // Hide from non-admins if ADMIN_ONLY is true
  if (ADMIN_ONLY && !user?.isAdmin) {
    return null
  }
  
  // Get the calendar URL - use the current origin to handle both dev and production
  const calendarUrl = `${window.location.origin}/api/calendar.ics`
  
  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(calendarUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = calendarUrl
      textArea.style.position = 'fixed'
      textArea.style.left = '-999999px'
      document.body.appendChild(textArea)
      textArea.select()
      try {
        document.execCommand('copy')
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch (err) {
        console.error('Fallback copy failed:', err)
      }
      document.body.removeChild(textArea)
    }
  }
  
  return (
    <div className="setting-item-vertical">
      <div className="setting-label">
        <h6>Agenda abonnement</h6>
        <p>Synchroniseer alle Stamjer evenementen met je eigen agenda-app</p>
      </div>
      
      <button
        type="button"
        className="btn btn-secondary"
        onClick={handleCopyUrl}
        disabled={copied}
      >
        {copied ? '✓ Gekopieerd' : 'Kopieer URL'}
      </button>
      
      <button
        type="button"
        className="calendar-subscription-toggle"
        onClick={() => setShowInstructions(!showInstructions)}
      >
        {showInstructions ? '▼' : '▶'} Hoe gebruik je dit?
      </button>
      
      {showInstructions && (
        <div className="calendar-subscription-instructions">
          <div className="instruction-section">
            <strong>Google Calendar:</strong>
            <ol>
              <li>Open Google Calendar op je computer</li>
              <li>Klik links op het plus-teken naast "Andere agenda's"</li>
              <li>Selecteer "Via URL"</li>
              <li>Plak de gekopieerde URL en klik op "Agenda toevoegen"</li>
            </ol>
          </div>
          
          <div className="instruction-section">
            <strong>Apple Calendar (iPhone/Mac):</strong>
            <ol>
              <li>Open de Kalender-app</li>
              <li>Ga naar Bestand → Nieuw agenda-abonnement (Mac) of tik op "Agenda's" → "Voeg abonnement toe" (iPhone)</li>
              <li>Plak de gekopieerde URL</li>
              <li>Klik op "Abonneer"</li>
            </ol>
          </div>
          
          <div className="instruction-section">
            <strong>Outlook:</strong>
            <ol>
              <li>Open Outlook Calendar</li>
              <li>Selecteer "Agenda toevoegen" → "Via internet"</li>
              <li>Plak de gekopieerde URL</li>
              <li>Geef de agenda een naam en klik op "Importeren"</li>
            </ol>
          </div>
          
          <p className="instruction-note">
            <strong>Let op:</strong> De agenda wordt automatisch gesynchroniseerd. 
            Wijzigingen in Stamjer worden binnen enkele uren zichtbaar in je agenda-app.
          </p>
        </div>
      )}
    </div>
  )
}
