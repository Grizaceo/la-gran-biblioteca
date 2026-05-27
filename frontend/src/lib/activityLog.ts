export type LogType = 'info' | 'success' | 'error' | 'warn'

export function addActivityLog(msg: string, type: LogType | string = 'info'): void {
  const content = document.getElementById('activity-log-content')
  if (!content) return

  const entry = document.createElement('div')
  entry.className = `log-entry log-${type}`

  const timeSpan = document.createElement('span')
  timeSpan.className = 'log-time'
  timeSpan.textContent = new Date().toTimeString().split(' ')[0]

  const textSpan = document.createElement('span')
  textSpan.className = 'log-text'
  textSpan.textContent = msg

  entry.appendChild(timeSpan)
  entry.appendChild(textSpan)
  content.appendChild(entry)
  content.scrollTop = content.scrollHeight
}
