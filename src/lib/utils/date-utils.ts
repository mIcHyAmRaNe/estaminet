import { t, locale } from '../i18n'

export function formatDateSeparator(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const isToday = d.toDateString() === today.toDateString()
  if (isToday) return t('chat.dateToday')
  const isYesterday = d.toDateString() === yesterday.toDateString()
  if (isYesterday) return t('chat.dateYesterday')
  return d.toLocaleDateString(locale.value === 'en' ? 'en-GB' : 'fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}
