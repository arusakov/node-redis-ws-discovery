import { deepEqual, equal, rejects } from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'

import { CHNL, SCKT, SID, SRVR } from '../src/constants.ts'

import { clearRedis, createRedis, WSDiscoveryForTests } from './utils.ts'

describe('Channels edge cases', () => {
  const redis = createRedis()
  const wsd = new WSDiscoveryForTests({
    redis,
    prefix: 'wsd_edge',
  })

  let serverId: number
  let socketId1: number
  let socketId2: number

  before(async () => {
    await wsd.connect()
    serverId = await wsd.registerServer('1.1.1.1', 300)
  })

  after(async () => {
    await clearRedis(redis, wsd.prefix)
    await redis.call('FT.DROPINDEX', wsd.indexScktChnl)
    await redis.del(wsd.prefix + '__migrations', wsd.prefix + '__migrations_lock')
    await redis.quit()
  })

  const reset = async () => {
    await clearRedis(redis, wsd.prefix)
    wsd.extraKeys = []
    socketId1 = await wsd.registerSocket(serverId, 11)
    socketId2 = await wsd.registerSocket(serverId, 22)
  }

  it('addChannel() & removeChannel() for nonexistent socket', async () => {
    await reset()
    const socketId = 123456

    equal(await wsd.addChannel(socketId, 'abc'), false)
    equal(await wsd.addChannels(socketId, 'abc', 'xyz'), false)
    equal(await wsd.removeChannel(socketId, 'abc'), false)
    equal(await wsd.removeChannels(socketId, 'abc', 'xyz'), false)

    // the hash must not be created without ttl
    equal(await redis.exists(wsd.getSocketKeyForTests(socketId)), 0)
  })

  it('channel validation', async () => {
    await reset()
    const comma = (channel: string) => (err: unknown) => {
      return err instanceof Error && err.message === `Comma is not allowed in channel (channel=${channel})`
    }

    await rejects(() => wsd.addChannel(socketId1, 'a,b'), comma('a,b'))
    await rejects(() => wsd.removeChannel(socketId1, ','), comma(','))
    await rejects(() => wsd.getSocketsByChannel('a,b'), comma('a,b'))
    await rejects(() => wsd.addChannels(socketId1, 'abc', 'x,y'), comma('x,y'))
    await rejects(() => wsd.removeChannels(socketId1, 'abc', ''), /Empty channel is not allowed/)

    // nothing is added when one of the channels is invalid
    deepEqual(await wsd.getSocket(socketId1, CHNL), { [CHNL]: [] })
  })

  it('channels with special characters', async () => {
    await reset()

    const channels = [
      'a-b', 'a.b', 'a:b', 'a b', 'a{b}', 'a|b', 'a@b', 'a%d', 'a*', '*', '$', '^a$', '[a]',
      '(a)', 'a\\b', 'a"b', "a'b", '~a', 'a!', 'a?', 'a+b', 'a=b', 'a/b', 'a;b', 'a<b>',
      'a\tb', 'привет', '😀', 'tag:{1}', '-', '.',
    ]

    equal(await wsd.addChannels(socketId1, ...channels), true)
    equal(await wsd.addChannel(socketId2, 'plain'), true)

    deepEqual(await wsd.getSocket(socketId1, CHNL), { [CHNL]: channels })

    for (const channel of channels) {
      deepEqual(
        await wsd.getSocketsByChannel(channel),
        [{ [SCKT]: socketId1, [SRVR]: serverId }],
        `search by ${JSON.stringify(channel)}`,
      )
    }

    equal(await wsd.removeChannels(socketId1, ...channels), true)
    deepEqual(await wsd.getSocket(socketId1, CHNL), { [CHNL]: [] })
  })

  it('channels are not Lua patterns', async () => {
    await reset()

    await wsd.addChannels(socketId1, 'ab', 'axb', 'a%b')

    // "a-b" and "a.b" would match "ab" and "axb" if they were patterns
    equal(await wsd.addChannel(socketId1, 'a-b'), true)
    equal(await wsd.addChannel(socketId1, 'a.b'), true)
    equal(await wsd.removeChannel(socketId1, 'a.b'), true)
    equal(await wsd.removeChannel(socketId1, 'a%'), false)
    equal(await wsd.removeChannel(socketId1, '.'), false)

    deepEqual(await wsd.getSocket(socketId1, CHNL), { [CHNL]: ['ab', 'axb', 'a%b', 'a-b'] })
  })

  it('addChannels() & removeChannels() partially', async () => {
    await reset()

    await wsd.addChannel(socketId1, 'b')
    equal(await wsd.addChannels(socketId1, 'a', 'b', 'c'), false)
    deepEqual(await wsd.getSocket(socketId1, CHNL), { [CHNL]: ['b', 'a', 'c'] })

    equal(await wsd.removeChannels(socketId1, 'x', 'a', 'c', 'y'), false)
    deepEqual(await wsd.getSocket(socketId1, CHNL), { [CHNL]: ['b'] })
  })

  it('getSocket() nonexistent socket', async () => {
    equal(await wsd.getSocket(123456, SRVR, SID), null)
  })

  it('getSocket() fields validation', async () => {
    await reset()

    await rejects(() => wsd.getSocket(socketId1), /no empty fields/)
    await rejects(
      // @ts-expect-error
      () => wsd.getSocket(socketId1, SRVR, SID, CHNL, 'ip'),
      /too many fields/,
    )
    await rejects(() => wsd.getSocketFieldsByChannel('abc', 100), /no empty fields/)
  })

  it('search skips expired and broken keys', async () => {
    await reset()
    await wsd.addChannels(socketId1, 'xyz')

    const brokenKey = wsd.getSocketKeyForTests(654321)
    await redis.set(brokenKey, 'not a hash')
    wsd.extraKeys = [wsd.getSocketKeyForTests(123456), brokenKey]

    deepEqual(
      await wsd.getSocketsByChannel('xyz'),
      [{ [SCKT]: socketId1, [SRVR]: serverId }],
    )
    deepEqual(await wsd.getSocketSidsByChannel('xyz'), [11])
    deepEqual(
      await wsd.getSocketFieldsByChannel('xyz', 100, SID, CHNL),
      [[socketId1, { [SID]: 11, [CHNL]: ['xyz'] }]],
    )

    await redis.del(brokenKey)
  })

  it('search with batch=1', async () => {
    await reset()
    await wsd.addChannel(socketId1, 'xyz')
    await wsd.addChannel(socketId2, 'xyz')

    deepEqual(
      await wsd.getSocketSidsByChannel('xyz', 1),
      [11, 22],
    )
    deepEqual(
      await wsd.getSocketFieldsByChannel('xyz', 1, SID),
      [[socketId1, { [SID]: 11 }], [socketId2, { [SID]: 22 }]],
    )
  })

  it('getSocketData() after channels changes', async () => {
    await reset()
    await wsd.addChannels(socketId1, 'a', 'b')
    await wsd.removeChannel(socketId1, 'a')

    deepEqual(await wsd.getSocketData(socketId1), [11, 'b'])
  })
})
