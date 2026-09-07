export type MessageUnit<T> =
  | { kind: 'single'; msg: T; index: number }
  | { kind: 'group'; messages: T[]; index: number }

export interface GroupResult<T> {
  units: MessageUnit<T>[]
  groupIdsByMsg: Map<string, string[]>
}

function sameMinute(a: { created_at?: string; timestamp?: string }, b: { created_at?: string; timestamp?: string }): boolean {
  const da = a.created_at ? new Date(a.created_at) : new Date()
  const db = b.created_at ? new Date(b.created_at) : new Date()
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate() &&
    da.getHours() === db.getHours() &&
    da.getMinutes() === db.getMinutes()
  )
}

interface Groupable {
  id: string
  login?: string
  content: string
  type: string
  created_at?: string
  timestamp?: string
}

export function computeMessageUnits<T extends Groupable>(
  messages: T[],
  isSpecial: (msg: T) => boolean,
): GroupResult<T> {
  const units: MessageUnit<T>[] = []
  const groupIdsByMsg = new Map<string, string[]>()

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (isSpecial(msg)) {
      units.push({ kind: 'single', msg, index: i })
      continue
    }
    const groupMsgs = [msg]
    let j = i + 1
    while (j < messages.length) {
      const next = messages[j]
      if (isSpecial(next)) break
      if (next.login === msg.login && sameMinute(msg, next)) {
        groupMsgs.push(next)
        j++
      } else break
    }
    units.push({ kind: 'group', messages: groupMsgs, index: i })
    const ids = groupMsgs.map((m) => m.id)
    for (const m of groupMsgs) groupIdsByMsg.set(m.id, ids)
    i = j - 1
  }
  return { units, groupIdsByMsg }
}
