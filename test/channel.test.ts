import { deepEqual, rejects } from 'assert/strict'
import { describe, it, before, after, beforeEach, afterEach } from 'node:test'

import { CHNL, CLNT, SRVR } from '../src/constants'

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

  let clientId1: number
  let clientId2: number
  let clientId3: number

  before(async () => {
    await wsd.connect()

    serverId1 = await wsd.registerServer(ip1, 300)
    serverId2 = await wsd.registerServer(ip2, 300)
  })

  beforeEach(async () => {
    clientId1 = await wsd.registerClient(serverId1, 1)
    clientId2 = await wsd.registerClient(serverId1, 2)
    clientId3 = await wsd.registerClient(serverId2, 1)
  })

  afterEach(async () => {
    await wsd.deleteClient(clientId1)
    await wsd.deleteClient(clientId2)
    await wsd.deleteClient(clientId3)
  })

  after(async () => {
    await clearRedis(redis, wsd.prefix)
    await redis.quit()
  })

  it('addChannel() OK', async () => {
    equal(
      await wsd.addChannel(clientId1, 'abc'),
      true,
    )

    equal(
      await wsd.addChannel(clientId1, 'abc'),
      false,
    )
  })

  it('addChannel() 3 channels', async () => {
    await wsd.addChannel(clientId2, 'abc')
    await wsd.addChannel(clientId2, 'xyz')
    await wsd.addChannel(clientId2, 'lmn')

    deepEqual(
      await wsd.getClientChannels(clientId2),
      ['abc', 'xyz', 'lmn'],
    )
  })

  it('addChannel() validation', async () => {
    await rejects(() => wsd.addChannel(clientId1, ''), (err) => {
      return err instanceof Error && err.message === 'Empty channel is not allowed'
    })
  })

  it('removeChanel()', async () => {
    equal(
      await wsd.addChannel(clientId3, 'abc'),
      true,
    )

    equal(
      await wsd.removeChannel(clientId3, 'abc'),
      true,
    )

    equal(
      await wsd.removeChannel(clientId3, 'abc'),
      false,
    )
  })

  it('removeChannel() validation', async () => {
    await rejects(() => wsd.removeChannel(clientId1, ''), (err) => {
      return err instanceof Error && err.message === 'Empty channel is not allowed'
    })
  })

  it('getClientsByChannel() empty', async () => {
    deepEqual(
      await wsd.getClientsByChannel('xyz'),
      [],
    )
  })

  it('getClientsByChannel() return one', async () => {
    await wsd.addChannel(clientId1, 'abc')

    deepEqual(
      await wsd.getClientsByChannel('xyz'),
      [],
    )
  })

  it('getClientsByChannel() one', async () => {
    await wsd.addChannel(clientId1, 'abc')
    await wsd.addChannel(clientId2, 'xyz')

    deepEqual(
      await wsd.getClientsByChannel('xyz'),
      [{
        [CLNT]: clientId2,
        [SRVR]: serverId1,
      }],
    )
  })

  it('getClientsByChannel() return two', async () => {
    await wsd.addChannel(clientId1, 'xyz')
    await wsd.addChannel(clientId2, 'abc')
    await wsd.addChannel(clientId3, 'xyz')

    deepEqual(
      await wsd.getClientsByChannel('xyz'),
      [
        {
          [CLNT]: clientId1,
          [SRVR]: serverId1,
        },
        {
          [CLNT]: clientId3,
          [SRVR]: serverId2,
        },
      ],
    )
  })

  it('getClientsByChannel() with batch=1', async () => {
    await wsd.addChannel(clientId1, 'xyz')
    await wsd.addChannel(clientId3, 'xyz')

    deepEqual(
      await wsd.getClientsByChannel('xyz'),
      [
        {
          [CLNT]: clientId1,
          [SRVR]: serverId1,
        },
        {
          [CLNT]: clientId3,
          [SRVR]: serverId2,
        },
      ],
    )
  })

  it('getClientsByChannel() multiple channels', async () => {
    await wsd.addChannel(clientId1, 'xyz')
    await wsd.addChannel(clientId1, 'abc')
    await wsd.addChannel(clientId1, '123')

    await wsd.addChannel(clientId3, 'qwerty')
    await wsd.addChannel(clientId3, 'xyz')

    deepEqual(
      await wsd.getClientsByChannel('xyz'),
      [
        {
          [CLNT]: clientId1,
          [SRVR]: serverId1,
        },
        {
          [CLNT]: clientId3,
          [SRVR]: serverId2,
        },
      ],
    )
  }) 
})
