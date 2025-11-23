import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNotifications } from '../../hooks/useQueries'
import { NotificationIcon } from '../icons'
import './NotificationCenter.css'

function NotificationCenter({ user }) {
  const navigate = useNavigate()
  const hasUser = Boolean(user?.id)

  const { data: notificationsData = { unreadCount: 0 } } = useNotifications(
    hasUser ? user.id : undefined,
    { enabled: hasUser }
  )

  const unreadCount = notificationsData?.unreadCount ?? 0
  const ariaLabel = useMemo(() => {
    if (unreadCount > 0) {
      return `Meldingen (${unreadCount} ongelezen)`
    }
    return 'Meldingen'
  }, [unreadCount])

  if (!hasUser) {
    return null
  }

  const handleClick = () => {
    navigate('/meldingen')
  }

  return (
    <div className="notification-center">
      <button
        type="button"
        className="notification-button"
        aria-label={ariaLabel}
        onClick={handleClick}
      >
        <NotificationIcon />
        {unreadCount > 0 && (
          <span className="notification-badge" aria-hidden="true">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
    </div>
  )
}

export default NotificationCenter
