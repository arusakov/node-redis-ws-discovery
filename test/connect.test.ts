import { equal, rejects } from 'assert/strict'
import { describe, it, before, after } from 'node:test'


import { clearRedis, createRedis, sleep, WSDiscoveryForTests } from './utils'

describe('connect', () => {
  const redis = createRedis()
  const wsd = new WSDiscoveryForTests({
    redis,
  })

  after(async () => {
    await clearRedis(redis, wsd.prefix)
    await redis.quit()
  })

  it('lock() wait', async () => {
    await wsd.lockForTests(300)
    await wsd.lockForTests(100)
  })

  it('lock() failed', async () => {
    await wsd.lockForTests(1000)

    await rejects(() => wsd.lockForTests(400), (e: Error) => {
      return e instanceof Error && e.message === 'can not take redis lock on key=wsd:__migrations_lock'
    })
    
  })

})
