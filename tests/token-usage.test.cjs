const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { test } = require('node:test')
const { createActivity } = require('../outputs/closure-companion/activity.cjs')
const { createQuota } = require('../outputs/closure-companion/quota.cjs')

test('working chats switch by event time with independent counters', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'closure-usage-'))
  const date = new Date()
  const folder = path.join(root, String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0'))
  fs.mkdirSync(folder, { recursive: true })
  const base = Date.now() - 20000
  function append(chat, offset, payload, type = 'event_msg') {
    const record = { timestamp: new Date(base + offset).toISOString(), type, payload }
    fs.appendFileSync(path.join(folder, `rollout-${chat}.jsonl`), JSON.stringify(record) + '\n')
  }
  function usage(chat, at, total, last) {
    append(chat, at, { type: 'token_count', info: {
      total_token_usage: { total_tokens: total }, last_token_usage: { total_tokens: last },
    } })
  }
  append('a', 1, { type: 'task_started', turn_id: 'first' })
  usage('a', 2, 100, 100)
  append('a', 3, { type: 'task_complete', turn_id: 'first' })
  append('a', 4, { type: 'task_started', turn_id: 'second' })
  usage('a', 5, 125, 25)
  const activity = createActivity(true, root)
  t.after(() => {
    activity.stop()
    fs.rmSync(root, { recursive: true, force: true })
  })
  assert.equal(activity.snapshot().closureCompanion.following, true)
  const read = () => activity.snapshot().closureCompanion.tokenUsage
  assert.deepEqual(read(), { total: 125, turn: 25 })
  async function expectUsage(expected) {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (JSON.stringify(read()) === JSON.stringify(expected)) break
      await delay(50)
    }
    assert.deepEqual(read(), expected)
  }

  append('b', 7, { type: 'task_started', turn_id: 'other' })
  await expectUsage(null)
  usage('b', 8, 250, 50)
  await expectUsage({ total: 250, turn: 50 })
  usage('a', 6, 130, 5) // Written later with an older event time.
  append('b', 9, { type: 'token_count', info: null })
  await delay(400)
  assert.deepEqual(read(), { total: 250, turn: 50 })
  usage('a', 10, 145, 15)
  await expectUsage({ total: 145, turn: 45 })
  append('agent', 11, { source: { subagent: {} } }, 'session_meta')
  append('agent', 12, { type: 'task_started', turn_id: 'child' })
  usage('agent', 13, 900, 900)
  await delay(400)
  assert.deepEqual(read(), { total: 145, turn: 45 })
  append('a', 14, { type: 'task_complete', turn_id: 'second' })
  await expectUsage({ total: 250, turn: 50 })
  append('b', 15, { type: 'task_complete', turn_id: 'other' })
  await delay(400)
  assert.deepEqual(read(), { total: 250, turn: 50 })
  assert.equal(activity.snapshot().work.mode, 'idle')
})

test('official account credits can accompany live rate windows', async (t) => {
  const now = Date.now()
  const quota = createQuota({
    enabled: true,
    home: 'unused',
    locate: async () => 'unused',
    connect: async (_exe, _home, operation) => operation(async (method) => {
      if (method === 'config/read') return { config: { model_provider: 'openai' } }
      if (method === 'account/read') return { account: { type: 'chatgpt' } }
      assert.equal(method, 'account/rateLimits/read')
      return { rateLimits: {
        limitId: 'codex', primary: { usedPercent: 23, windowDurationMins: 300, resetsAt: now / 1000 + 60 },
        credits: { hasCredits: true, unlimited: false, balance: '3.25' },
      } }
    }),
  })
  t.after(() => quota.stop())
  await quota.ready
  assert.equal(quota.snapshot().source, 'official')
  assert.equal(quota.snapshot().quota[0].remaining, 77)
  assert.deepEqual(quota.snapshot().credits, { balance: '3.25' })
})

test('third-party quota exposes generic source and standard currency only', async (t) => {
  const provider = {
    base_url: 'https://www.hejuapi.com/v1',
    experimental_bearer_token: 'sk-fixture-key',
  }
  for (const [unit, expected] of [['USD', 'USD'], ['PRIVATE', '']]) {
    const quota = createQuota({
      enabled: true,
      home: 'unused',
      locate: async () => 'unused',
      connect: async (_exe, _home, operation) => operation(async (method) => {
        assert.equal(method, 'config/read')
        return { config: { model_provider: 'privateProvider', model_providers: { privateProvider: provider } } }
      }),
      request: async () => new Response(JSON.stringify({
        success: true, data: { remaining: 42.1, unit, account_name: 'private-account' },
      })),
    })
    t.after(() => quota.stop())
    await quota.ready
    assert.deepEqual(quota.snapshot(), {
      source: 'thirdParty', quota: [], balance: { remaining: 42.1, unit: expected }, credits: null, revision: 1,
    })
  }
})
