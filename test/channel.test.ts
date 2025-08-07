import { deepEqual, rejects } from 'assert/strict'
import { describe, it, before, after, beforeEach, afterEach } from 'node:test'

import { CHNL, SCKT, SRVR } from '../src/constants'

import { clearRedis, createRedis, WSDiscoveryForTests } from './utils'
import { equal } from 'assert'

describe('Channels', () => {
  const redis = createRedis()
  const wsd = new WSDiscoveryForTests({
    redis,
  })

  const ip1 = '1.1.1.1'
  const ip2 = '1.1.1.2'
  let serverId1: number
  let serverId2: number

  let socketId1: number
  let socketId2: number
  let socketId3: number

  before(async () => {
    await wsd.connect()

    serverId1 = await wsd.registerServer(ip1, 300)
    serverId2 = await wsd.registerServer(ip2, 300)
  })

  beforeEach(async () => {
    socketId1 = await wsd.registerSocket(serverId1, 1)
    socketId2 = await wsd.registerSocket(serverId1, 2)
    socketId3 = await wsd.registerSocket(serverId2, 1)
  })

  afterEach(async () => {
    await wsd.deleteSocket(socketId1)
    await wsd.deleteSocket(socketId2)
    await wsd.deleteSocket(socketId3)
  })

  after(async () => {
    await clearRedis(redis, wsd.prefix)
    await redis.quit()
  })

  it('addChannel() OK', async () => {
    equal(
      await wsd.addChannel(socketId1, 'abc'),
      true,
    )

    equal(
      await wsd.addChannel(socketId1, 'abc'),
      false,
    )
  })

  it('addChannel() 3 channels', async () => {
    await wsd.addChannel(socketId2, 'abc')
    await wsd.addChannel(socketId2, 'xyz')
    await wsd.addChannel(socketId2, 'lmn')

    deepEqual(
      await wsd.getSocket(socketId2, CHNL),
      { [CHNL]: ['abc', 'xyz', 'lmn'] },
    )
  })

  it('addChannel() validation', async () => {
    await rejects(() => wsd.addChannel(socketId1, ''), (err) => {
      return err instanceof Error && err.message === 'Empty channel is not allowed'
    })
  })

  it('removeChanel()', async () => {
    equal(
      await wsd.addChannel(socketId3, 'abc'),
      true,
    )

    equal(
      await wsd.removeChannel(socketId3, 'abc'),
      true,
    )

    equal(
      await wsd.removeChannel(socketId3, 'abc'),
      false,
    )
  })

  it('removeChannel() validation', async () => {
    await rejects(() => wsd.removeChannel(socketId1, ''), (err) => {
      return err instanceof Error && err.message === 'Empty channel is not allowed'
    })
  })

  it('getSocketsByChannel() validation', async () => {
    await rejects(() => wsd.getSocketsByChannel(''), (err) => {
      return err instanceof Error && err.message === 'Empty channel is not allowed'
    })
  })

  it('getSocketsByChannel() no sockets', async () => {
    deepEqual(
      await wsd.getSocketsByChannel('xyz'),
      [],
    )
  })

  it('getSocketsByChannel() return empty array', async () => {
    await wsd.addChannel(socketId1, 'abc')

    deepEqual(
      await wsd.getSocketsByChannel('xyz'),
      [],
    )
  })

  it('getSocketsByChannel() one', async () => {
    await wsd.addChannel(socketId1, 'abc')
    await wsd.addChannel(socketId2, 'xyz')

    deepEqual(
      await wsd.getSocketsByChannel('xyz'),
      [{
        [SCKT]: socketId2,
        [SRVR]: serverId1,
      }],
    )
  })

  it('getSocketsByChannel() return two', async () => {
    await wsd.addChannel(socketId1, 'xyz')
    await wsd.addChannel(socketId2, 'abc')
    await wsd.addChannel(socketId3, 'xyz')

    deepEqual(
      await wsd.getSocketsByChannel('xyz'),
      [
        {
          [SCKT]: socketId1,
          [SRVR]: serverId1,
        },
        {
          [SCKT]: socketId3,
          [SRVR]: serverId2,
        },
      ],
    )
  })

  it('getSocketsByChannel() with batch=1', async () => {
    await wsd.addChannel(socketId1, 'xyz')
    await wsd.addChannel(socketId3, 'xyz')

    deepEqual(
      await wsd.getSocketsByChannel('xyz', 1),
      [
        {
          [SCKT]: socketId1,
          [SRVR]: serverId1,
        },
        {
          [SCKT]: socketId3,
          [SRVR]: serverId2,
        },
      ],
    )
  })

  it('getSocketsByChannel() multiple channels', async () => {
    await wsd.addChannel(socketId1, 'xyz')
    await wsd.addChannel(socketId1, 'abc')
    await wsd.addChannel(socketId1, '123')

    await wsd.addChannel(socketId3, 'qwerty')
    await wsd.addChannel(socketId3, 'xyz')

    deepEqual(
      await wsd.getSocketsByChannel('xyz'),
      [
        {
          [SCKT]: socketId1,
          [SRVR]: serverId1,
        },
        {
          [SCKT]: socketId3,
          [SRVR]: serverId2,
        },
      ],
    )
  })

  it('addChannels() multiple channels', async () => {
    equal(
      await wsd.addChannels(socketId1, 'abc', 'xyz', 'lmn'),
      true,
    )

    deepEqual(
      await wsd.getSocket(socketId1, CHNL),
      { [CHNL]: ['abc', 'xyz', 'lmn'] },
    )
  })

  it('addChannels() empty array', async () => {
    equal(
      await wsd.addChannels(socketId1),
      true,
    )
  })

  it('removeChannels() multiple channels', async () => {
    await wsd.addChannels(socketId2, 'abc', 'xyz', 'lmn', 'qwe')

    equal(
      await wsd.removeChannels(socketId2, 'xyz', 'lmn'),
      true,
    )

    deepEqual(
      await wsd.getSocket(socketId2, CHNL),
      { [CHNL]: ['abc', 'qwe'] },
    )
  })

  it('removeChannels() empty array', async () => {
    equal(
      await wsd.removeChannels(socketId1),
      true,
    )
  })

  it('getSocketSidsByChannel() return session IDs', async () => {
    await wsd.addChannel(socketId1, 'xyz')
    await wsd.addChannel(socketId2, 'xyz')

    deepEqual(
      await wsd.getSocketSidsByChannel('xyz'),
      [1, 2]
    )
  })

  it('getSocketSidsByChannel() empty channel', async () => {
    deepEqual(
      await wsd.getSocketSidsByChannel('nonexistent'),
      [],
    )
  })

  it('getSocketFieldsByChannel() return specific fields', async () => {
    await wsd.addChannel(socketId1, 'xyz')
    await wsd.addChannel(socketId3, 'xyz')

    const result = await wsd.getSocketFieldsByChannel('xyz', 100, SRVR, CHNL)

    deepEqual(result, [
      [socketId1, { [SRVR]: serverId1, [CHNL]: ['xyz'] }],
      [socketId3, { [SRVR]: serverId2, [CHNL]: ['xyz'] }],
    ])
  })

  it('getSocketData() return session ID and channels', async () => {
    await wsd.addChannel(socketId1, 'abc')
    await wsd.addChannel(socketId1, 'xyz')

    const result = await wsd.getSocketData(socketId1)
    deepEqual(result, [1, 'abc,xyz']) // session ID = 1, channels as comma-separated string
  })

  it('getSocketData() nonexistent socket', async () => {
    const result = await wsd.getSocketData(99999)
    equal(result, null)
  })
})
