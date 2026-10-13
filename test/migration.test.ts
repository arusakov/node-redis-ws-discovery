import { deepEqual, equal, rejects } from 'node:assert/strict'
import { describe, it, afterEach, after } from 'node:test'

import { CHNL, SCKT, SRVR } from '../src/constants.ts'

import { createRedis, WSDiscoveryForTests } from './utils.ts'

describe('migrations', () => {
  const redis = createRedis()
  const wsd = new WSDiscoveryForTests({ redis, prefix: 'wsd_mig' })

  const legacyIndex = wsd.getLegacyIndexName()
  const migrationsKey = wsd.prefix + '__migrations'
  const lockKey = wsd.prefix + '__migrations_lock'
  const socketKeys = [wsd.prefixSocket + '1', wsd.prefixSocket + '2']

  const listIndexes = async () => {
    const indexes = await redis.call('FT._LIST') as string[]
    return indexes.filter((index) => index.startsWith(wsd.prefix)).sort()
  }

  const createLegacyIndex = () => redis.call(
    'FT.CREATE', legacyIndex, 'PREFIX', 1, wsd.prefixSocket, 'SCHEMA', CHNL, 'TAG',
  )

  const createSockets = async () => {
    await redis.hset(socketKeys[0], SRVR, 1, 'sid', 1, CHNL, ',Foo,')
    await redis.hset(socketKeys[1], SRVR, 1, 'sid', 2, CHNL, ',foo,')
  }

  const assertSearch = async () => {
    deepEqual(await wsd.getSocketsByChannel('Foo'), [{ [SCKT]: 1, [SRVR]: 1 }])
    deepEqual(await wsd.getSocketsByChannel('foo'), [{ [SCKT]: 2, [SRVR]: 1 }])
  }

  afterEach(async () => {
    for (const index of await listIndexes()) {
      await redis.call('FT.DROPINDEX', index)
    }
    await redis.del(migrationsKey, lockKey, ...socketKeys)
    wsd.indexingPolls = 0
  })

  after(async () => {
    await redis.quit()
  })

  it('new installation', async () => {
    await createSockets()
    await wsd.connect()

    deepEqual(await listIndexes(), [wsd.indexScktChnl])
    equal(wsd.indexScktChnl, legacyIndex + '_v2')
    await assertSearch()

    deepEqual((await redis.smembers(migrationsKey)).sort(), ['m1', 'm2'])

    // nothing changes
    await wsd.connect()
    deepEqual(await listIndexes(), [wsd.indexScktChnl])
    await assertSearch()
  })

  it('upgrade from the legacy index', async () => {
    await createLegacyIndex()
    await redis.sadd(migrationsKey, 'm0')
    await createSockets()

    // legacy index is case insensitive
    equal((await redis.call('FT.SEARCH', legacyIndex, '@chnl:{Foo}', 'NOCONTENT') as unknown[])[0], 2)

    wsd.indexingPolls = 2
    await wsd.connect()

    equal(wsd.indexingPolls, 0, 'waits for the indexing')
    deepEqual(await listIndexes(), [wsd.indexScktChnl])
    await assertSearch()

    equal(await redis.exists(...socketKeys), 2, 'hashes are not deleted')
    equal(await redis.exists(lockKey), 0)
    deepEqual((await redis.smembers(migrationsKey)).sort(), ['m0', 'm1', 'm2'])
  })

  it('interrupted migration', async () => {
    // the new index is created, but the legacy index is not dropped yet
    await createLegacyIndex()
    await redis.call(
      'FT.CREATE', wsd.indexScktChnl, 'PREFIX', 1, wsd.prefixSocket, 'SCHEMA', CHNL, 'TAG', 'CASESENSITIVE',
    )
    await createSockets()

    await wsd.connect()

    deepEqual(await listIndexes(), [wsd.indexScktChnl])
    await assertSearch()
  })

  it('failed migration keeps the legacy index', async () => {
    await createLegacyIndex()

    const original = redis.call.bind(redis) as (...args: any[]) => Promise<unknown>
    ;(redis as any).call = (name: string, ...args: unknown[]) => {
      return name === 'FT.CREATE' ? Promise.reject(new Error('boom')) : original(name, ...args)
    }

    try {
      await rejects(() => wsd.connect(), /boom/)
    } finally {
      delete (redis as any).call
    }

    // the lock is released, nothing is marked as applied, the legacy index is still there
    equal(await redis.exists(lockKey), 0)
    equal(await redis.exists(migrationsKey), 0)
    deepEqual(await listIndexes(), [legacyIndex])

    await wsd.connect()
    deepEqual(await listIndexes(), [wsd.indexScktChnl])
  })
})
