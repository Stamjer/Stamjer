/**
 * ================================================================
 * LOCATION INPUT COMPONENT WITH AUTOCOMPLETE
 * ================================================================
 * 
 * A professional location picker using Google Places Autocomplete API.
 * Provides address suggestions as the user types and stores the full
 * formatted address.
 * 
 * @author R.S. Kort
 */

import React, { useEffect, useRef, useState } from 'react'
import './LocationInput.css'

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''

export default function LocationInput({ value, onChange, placeholder, disabled, error }) {
  const inputRef = useRef(null)
  const autocompleteRef = useRef(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [loadError, setLoadError] = useState(null)

  useEffect(() => {
    // Check if Google Maps API is already loaded
    if (window.google && window.google.maps && window.google.maps.places) {
      setIsLoaded(true)
      return
    }

    // Load Google Maps API script
    const existingScript = document.getElementById('google-maps-script')
    
    if (!existingScript) {
      const script = document.createElement('script')
      script.id = 'google-maps-script'
      script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places&language=nl&region=NL`
      script.async = true
      script.defer = true
      
      script.onload = () => {
        setIsLoaded(true)
      }
      
      script.onerror = () => {
        setLoadError('Kon locatie service niet laden')
      }
      
      document.head.appendChild(script)
    } else {
      // Script exists, wait for it to load
      const checkLoaded = setInterval(() => {
        if (window.google && window.google.maps && window.google.maps.places) {
          setIsLoaded(true)
          clearInterval(checkLoaded)
        }
      }, 100)

      // Timeout after 10 seconds
      setTimeout(() => {
        clearInterval(checkLoaded)
        if (!isLoaded) {
          setLoadError('Locatie service laden duurde te lang')
        }
      }, 10000)
    }
  }, [])

  useEffect(() => {
    if (!isLoaded || !inputRef.current || disabled) {
      return
    }

    try {
      // Initialize autocomplete
      const autocomplete = new window.google.maps.places.Autocomplete(inputRef.current, {
        componentRestrictions: { country: 'nl' }, // Restrict to Netherlands
        fields: ['formatted_address', 'name', 'address_components', 'geometry'],
        types: ['establishment', 'geocode'] // Allow both places and addresses
      })

      // Handle place selection
      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace()
        
        if (!place.formatted_address && !place.name) {
          // User didn't select from dropdown, just keep what they typed
          return
        }

        // Use the formatted address or place name
        const location = place.formatted_address || place.name || ''
        onChange(location)
      })

      autocompleteRef.current = autocomplete
    } catch (err) {
      console.error('Error initializing Google Places Autocomplete:', err)
      setLoadError('Kon locatie picker niet initialiseren')
    }

    return () => {
      if (autocompleteRef.current) {
        window.google.maps.event.clearInstanceListeners(autocompleteRef.current)
      }
    }
  }, [isLoaded, onChange, disabled])

  // Fallback to regular input if API fails to load
  if (loadError || !GOOGLE_MAPS_API_KEY) {
    return (
      <div className="location-input-wrapper">
        <input
          type="text"
          className={`form-input ${error ? 'error' : ''}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || 'bijv. Scouting Marco Polo Delft'}
          disabled={disabled}
        />
        {loadError && (
          <div className="location-input-hint warning">
            {loadError}. Gebruik tekstveld als alternatief.
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="location-input-wrapper">
      <input
        ref={inputRef}
        type="text"
        className={`form-input location-input ${error ? 'error' : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || 'bijv. Scouting Marco Polo Delft'}
        disabled={disabled || !isLoaded}
        autoComplete="off"
      />
      {!isLoaded && (
        <div className="location-input-hint">
          <div className="loading-spinner tiny"></div>
          Locatie service laden...
        </div>
      )}
      {isLoaded && (
        <div className="location-input-hint">
          Begin te typen voor suggesties
        </div>
      )}
    </div>
  )
}
