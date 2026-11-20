const fs = require('node:fs')
const path = require('node:path')

const tailLimit = 256 * 1024
const activeTimeout = 20 * 60 * 1000
const quotaTimeout = 30 * 60 * 1000
const talkHold = 2200 // Keep a short response visible across a one-second renderer poll.
const rolloutName = /^rollout-[\w-]+\.jsonl$/i

function createActivity(enabled, sessionsRoot) {
  const files = new Map()
  const pending = new Map()
  const tools = { ok: 0, fail: 0 }
  const turnEnd = { seq: 0, kind: 'completed', at: 0 }
  const errors = { count: 0 }
  const startedAt = Date.now()
  let rateLimits = { at: 0, windows: [] }
  let watcher

  function applyLine(line, session, notify) {
    let record
    try { record = JSON.parse(line) } catch { return }
    if (!record.payload) return
    const event = record.payload
    const at = Date.parse(record.timestamp)
    if (record.type === 'response_item') {
      if (session.turn && event.type === 'message' && event.role === 'assistant') {
        session.mode = 'outputting'
        if (notify && Number.isFinite(at)) session.talkUntil = at + talkHold
      }
      return
    }
    if (record.type !== 'event_msg') return

    if (event.type === 'token_count') {
      const limits = event.rate_limits
      if (!limits || (limits.limit_id && limits.limit_id !== 'codex') || !Number.isFinite(at) || at < rateLimits.at) return
      const windows = [limits.primary, limits.secondary].filter((entry) =>
        Number.isFinite(entry?.used_percent) && entry.used_percent >= 0 && entry.used_percent <= 100 &&
        Number.isInteger(entry.window_minutes) && entry.window_minutes > 0 && Number.isFinite(entry.resets_at)
      ).map((entry) => ({ minutes: entry.window_minutes, remaining: 100 - entry.used_percent, resetsAt: entry.resets_at * 1000 }))
      if (windows.length) rateLimits = { at, windows }
      return
    }

    if (event.type === 'task_started') {
      if (typeof event.turn_id !== 'string') return
      session.turn = event.turn_id
      session.mode = 'thinking'
      session.failed = false
      session.talkUntil = 0
      return
    }
    if (!session.turn || (event.turn_id && event.turn_id !== session.turn)) return

    if (event.type === 'agent_message' ||
        (['item_started', 'item_completed'].includes(event.type) && event.item?.type === 'AgentMessage')) {
      session.mode = 'outputting'
      if (notify && Number.isFinite(at)) session.talkUntil = at + talkHold
    } else if (event.type === 'item_completed' && ['CommandExecution', 'McpToolCall', 'FileChange'].includes(event.item?.type)) {
      session.mode = 'thinking'
      const item = event.item
      const mcp = item.type === 'McpToolCall'
      const toolError = mcp && (item.status === 'failed' || item.result?.isError === true || item.result?.is_error === true)
      // A command can run normally and still return a nonzero result (for example, a search with no matches).
      if (notify && toolError) tools.fail++
      else if (notify && item.status === 'completed' && (item.exit_code ?? 0) === 0) tools.ok++
    } else if (event.type === 'error' && !event.will_retry && !event.willRetry) {
      session.failed = true
      session.talkUntil = 0
      if (notify) errors.count++
    } else if (event.type === 'task_complete' || event.type === 'turn_aborted') {
      const kind = event.type === 'turn_aborted' ? 'interrupted' : session.failed ? 'error' : 'completed'
      session.turn = null
      session.mode = null
      if (kind !== 'completed') session.talkUntil = 0
      if (notify) {
        turnEnd.seq++
        turnEnd.kind = kind
        turnEnd.at = Date.now()
      }
    }
  }

  function readTail(filename, notifyExisting = true) {
    let fd
    try {
      fd = fs.openSync(filename, 'r')
      const { size, mtimeMs, birthtimeMs } = fs.fstatSync(fd)
      const prior = files.get(filename)
      const session = prior || { offset: 0, updated: 0, turn: null, mode: null, talkUntil: 0, failed: false }
      const truncated = session.offset > size
      if (truncated) Object.assign(session, { offset: 0, turn: null, mode: null, talkUntil: 0, failed: false })
      if (size === session.offset) return
      const start = Math.max(session.offset, size - tailLimit)
      const data = Buffer.alloc(size - start)
      const bytes = fs.readSync(fd, data, 0, data.length, start)
      session.updated = mtimeMs
      files.set(filename, session)
      if (bytes === 0) return
      const end = data.lastIndexOf(10, bytes - 1)
      if (end < 0) return
      // The writer may be between chunks. Resume immediately after the final newline.
      session.offset = start + end + 1
      // A newly created rollout can finish before its first watch callback.
      const notify = notifyExisting && !truncated && (Boolean(prior) || birthtimeMs >= startedAt)
      for (const line of data.subarray(0, end).toString('utf8').split('\n')) applyLine(line, session, notify)
    } catch (error) {
      if (error.code === 'ENOENT') files.delete(filename)
    } finally {
      if (fd !== undefined) fs.closeSync(fd)
    }
  }

  function queue(filename) {
    if (!filename || !rolloutName.test(path.basename(filename))) return
    const full = path.resolve(sessionsRoot, filename)
    if (!full.startsWith(sessionsRoot + path.sep) || pending.has(full)) return
    pending.set(full, setTimeout(() => {
      pending.delete(full)
      readTail(full)
    }, 180))
  }

  if (enabled && fs.existsSync(sessionsRoot)) {
    try {
      watcher = fs.watch(sessionsRoot, { recursive: true }, (_event, filename) => queue(filename))
      watcher.on('error', () => { watcher?.close(); watcher = undefined })
      for (const offset of [0, 1]) {
        const date = new Date()
        date.setDate(date.getDate() - offset)
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        const folder = path.join(sessionsRoot, String(date.getFullYear()), month, day)
        if (!fs.existsSync(folder)) continue
        for (const name of fs.readdirSync(folder)) {
          if (!rolloutName.test(name)) continue
          const filename = path.join(folder, name)
          if (Date.now() - fs.statSync(filename, { throwIfNoEntry: false })?.mtimeMs < quotaTimeout) readTail(filename, false)
        }
      }
    } catch { watcher?.close(); watcher = undefined }
  }

  return {
    snapshot() {
      const now = Date.now()
      let active
      for (const [filename, session] of files) {
        if (now - session.updated > activeTimeout) files.delete(filename)
        else if ((session.mode || session.talkUntil > now) && (!active || session.updated > active.updated)) active = session
      }
      return {
        closureCompanion: {
          following: Boolean(watcher), completed: now - turnEnd.at < 10000 && turnEnd.kind === 'completed',
          quota: now - rateLimits.at < quotaTimeout ? rateLimits.windows.filter((entry) => entry.resetsAt > now) : [],
        },
        work: { mode: active?.talkUntil > now ? 'outputting' : active?.mode || 'idle' },
        tools: { ...tools },
        errors: { ...errors },
        turnEnd: { seq: turnEnd.seq, kind: turnEnd.kind },
      }
    },
    stop() {
      watcher?.close()
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    },
  }
}

module.exports = { createActivity }
