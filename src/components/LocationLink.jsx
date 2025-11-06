/**
 * ================================================================
 * LOCATION LINK COMPONENT
 * ================================================================
 * 
 * A component that makes location text clickable and opens in the
 * user's default maps application (Google Maps, Apple Maps, Waze, etc.)
 * 
 * @author R.S. Kort
 */

import React from 'react'
import './LocationLink.css'

/**
 * Creates a universal maps link that works across platforms
 * Uses Google Maps which is universally supported and will open in:
 * - iOS: User's default maps app (can be Google Maps, Apple Maps, Waze, etc.)
 * - Android: User's default maps app (typically Google Maps)
 * - Desktop: Google Maps in browser
 * 
 * @param {string} location - The location string (e.g., "Veulenkamp 41, 2623 XA Delft")
 * @returns {string} - The maps URL
 */
function createMapsLink(location) {
  if (!location) return '#'
  
  const encodedLocation = encodeURIComponent(location)
  
  // Use Google Maps URL which is universally supported and lets the OS/browser
  // decide which maps app to open based on user preferences
  return `https://www.google.com/maps/search/?api=1&query=${encodedLocation}`
}

/**
 * LocationLink component
 * Displays a clickable location that opens in the user's default maps app
 * 
 * @param {Object} props
 * @param {string} props.location - The location string to display and link
 * @param {string} props.className - Optional additional CSS class
 * @param {boolean} props.showIcon - Whether to show a map pin icon (default: true)
 */
export default function LocationLink({ location, className = '', showIcon = true }) {
  if (!location) return null
  
  const mapsUrl = createMapsLink(location)
  
  const handleClick = (e) => {
    // Prevent default link behavior
    e.preventDefault()
    
    // Open in a new window/tab
    window.open(mapsUrl, '_blank', 'noopener,noreferrer')
  }
  
  return (
    <a
      href={mapsUrl}
      onClick={handleClick}
      className={`location-link ${className}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${location} in kaarten`}
      title="Open in kaarten"
    >
      <span className="location-text">{location}</span>
    </a>
  )
}
