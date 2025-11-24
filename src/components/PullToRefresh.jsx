import React from 'react'
import useDeviceDetection from '../hooks/useDeviceDetection'
import usePullToRefresh from '../hooks/usePullToRefresh'
import './PullToRefresh.css'

const RefreshIcon = ({ spinning, ready }) => {
  return (
    <span className={`ptr-icon${spinning ? ' spinning' : ''}${ready ? ' ready' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path
          d="M17.65 6.35A7.95 7.95 0 0 0 12 4V1L7 6l5 5V7a5 5 0 0 1 3.95 8.03l1.5 1.3A7 7 0 0 0 17.65 6.35Z"
          fill="currentColor"
        />
      </svg>
    </span>
  )
}

function PullToRefresh({ onRefresh, disabled = false }) {
  const { isMobile, hasTouch } = useDeviceDetection()
  const enabled = !disabled && (isMobile || hasTouch)

  const { pullDistance, progress, status, isActive, isReady, isRefreshing } = usePullToRefresh({
    enabled,
    threshold: 120,
    maxPull: 200,
    onRefresh,
  })

  if (!enabled) {
    return null
  }

  const label =
    status === 'refreshing'
      ? 'Data opnieuw laden...'
      : status === 'ready'
        ? 'Loslaten om alles te herladen'
        : 'Veeg omlaag voor een harde refresh'

  const isVisible = isActive || isRefreshing
  const translateY = isVisible ? Math.min(pullDistance, 96) + 6 : -18
  const opacity = isVisible ? Math.min(1, 0.35 + progress) : 0

  return (
    <div className={`ptr-shell${isVisible ? ' is-visible' : ''}${isRefreshing ? ' is-refreshing' : ''}`}>
      <div
        className="ptr-pill"
        aria-live="polite"
        style={{
          transform: `translate(-50%, ${translateY}px)`,
          opacity,
        }}
      >
        <RefreshIcon spinning={isRefreshing} ready={isReady} />
        <div className="ptr-copy">
          <span className="ptr-label">{label}</span>
          <div className="ptr-progress" aria-hidden="true">
            <div className="ptr-progress-bar" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default PullToRefresh
