import React, { useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'

function NotFound() {
  const headingRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <div className="not-found-page">
      <div className="not-found-content">
        <h1 ref={headingRef} tabIndex={-1}>Pagina niet gevonden</h1>
        <p>We konden de gevraagde pagina niet vinden. Controleer het adres of keer terug naar de startpagina.</p>
        <div className="not-found-actions">
          <Link to="/" className="btn btn-primary">
            Naar de startpagina
          </Link>
          <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>
            Ga terug
          </button>
        </div>
      </div>
    </div>
  )
}

export default NotFound
