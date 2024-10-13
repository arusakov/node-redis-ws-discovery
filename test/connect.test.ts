import { equal, rejects } from 'assert/strict'
import { describe, it, before, after } from 'node:test'


import { clearRedis, createRedis, sleep, WSDiscoveryForTests } from './utils'
import { __MIGRATIONS } from '../src/constants'

describe('connect', () => {
  const redis = createRedis()
  const wsd = new WSDiscoveryForTests({
    redis,
  })


  after(async () => {
    await clearRedis(redis, wsd.prefix)
    await redis.quit()
  })

  it('lock is already taken', async () => {
    await wsd.lockForTests(1)
    await wsd.connect()
  })

})
