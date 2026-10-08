import React, { useEffect, useId, useRef } from 'react'

export default function ManagementDialog({ title, onClose, busy = false, children }) {
  const dialogRef = useRef(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = dialogRef.current
    const previousFocus = document.activeElement
    dialog.showModal()
    return () => { dialog.close(); previousFocus?.focus() }
  }, [])
  return (
    <dialog ref={dialogRef} className="management-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
      <div className="management-dialog-heading"><h2 id={titleId}>{title}</h2><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy} aria-label="Sluiten">×</button></div>
      {children}
    </dialog>
  )
}
