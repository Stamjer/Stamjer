const linkRegex = /\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g
const boldRegex = /\*\*(.+?)\*\*/g
const italicRegex = /_(.+?)_/g

function escapeHtml(input = '') {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function applyBasicFormatting(escaped) {
  return escaped
    .replace(linkRegex, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(boldRegex, '<strong>$1</strong>')
    .replace(italicRegex, '<em>$1</em>')
}

function wrapLists(html) {
  const lines = html.split('\n')
  const wrapped = []
  let inList = false

  lines.forEach((line) => {
    const bulletMatch = line.match(/^\s*-\s+(.*)$/)
    if (bulletMatch) {
      if (!inList) {
        wrapped.push('<ul>')
        inList = true
      }
      wrapped.push(`<li>${bulletMatch[1]}</li>`)
    } else {
      if (inList) {
        wrapped.push('</ul>')
        inList = false
      }
      wrapped.push(line)
    }
  })

  if (inList) {
    wrapped.push('</ul>')
  }

  return wrapped.join('\n')
}

export function formatNotificationMessage(message = '') {
  if (!message) return ''

  const escaped = escapeHtml(message)
  const withFormatting = applyBasicFormatting(escaped)
  const withLists = wrapLists(withFormatting)

  return withLists.replace(/\n/g, '<br />')
}

export function formatNotificationMessageMarkup(message = '') {
  return { __html: formatNotificationMessage(message) }
}
