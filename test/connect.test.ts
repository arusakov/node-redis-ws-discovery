import { deepEqual, equal, rejects, throws } from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'


import { clearRedis, createRedis, sleep, WSDiscoveryForTests } from './utils.ts'

describe('connect', () => {
  const redis = createRedis()
  const wsd = new WSDiscoveryForTests({
    redis,
  })

  after(async () => {
    await clearRedis(redis, wsd.prefix)
    await redis.quit()
  })

  it('connect() twice', async () => {
    await wsd.connect()
    await wsd.connect()

    equal(await redis.exists(wsd.prefix + '__migrations_lock'), 0)
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

describe('options', () => {
  const redis = createRedis()

  after(async () => {
    await clearRedis(redis, 'wsd_ttl:')
    await redis.quit()
  })

  it('default ttl', () => {
    const wsd = new WSDiscoveryForTests({ redis })

    equal(wsd.ttlServer, 30)
    equal(wsd.ttlSocket, 120)
  })

  it('partial ttl', () => {
    const wsd = new WSDiscoveryForTests({ redis, ttl: { server: 5 } })

    equal(wsd.ttlServer, 5)
    equal(wsd.ttlSocket, 120)
  })

  it('bad ttl', () => {
    throws(() => new WSDiscoveryForTests({ redis, ttl: { server: 0 } }), /ttl must be > 0/)
    throws(() => new WSDiscoveryForTests({ redis, ttl: { socket: -1 } }), /ttl must be > 0/)
  })

  it('custom ttl is used', async () => {
    const wsd = new WSDiscoveryForTests({ redis, prefix: 'wsd_ttl', ttl: { server: 50, socket: 60 } })
    await wsd.connect()

    const serverId = await wsd.registerServer('1.1.1.1')
    const socketId = await wsd.registerSocket(serverId, 1)

    deepEqual(
      [await wsd.getServerTTL(serverId), await wsd.getSocketTTL(socketId)],
      [50, 60],
    )

    equal(await wsd.updateServerTTL(serverId), true)
    equal(await wsd.updateSocketTTL(socketId), true)
    await redis.call('FT.DROPINDEX', wsd.indexScktChnl)
    await redis.del(wsd.prefix + '__migrations', wsd.prefix + '__migrations_lock')
  })
})
