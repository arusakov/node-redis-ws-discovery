import { deepEqual } from 'assert/strict'
import { describe, it, before, after } from 'node:test'

import Redis from 'ioredis'

import { clearRedis, WSDiscoveryForTests } from './utils'
import { rejects } from 'assert'

describe('Channels', () => {
  const redis = new Redis({ lazyConnect: true })
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

    serverId1 = await wsd.registerServer(ip1)
    serverId2 = await wsd.registerServer(ip2)

    clientId1 = await wsd.registerClient(serverId1, 1)
    clientId2 = await wsd.registerClient(serverId1, 2)
    clientId3 = await wsd.registerClient(serverId2, 1)
  })

  after(async () => {
    await clearRedis(redis, '')
    await redis.quit()
  })

  it('addChannel() OK', async () => {
    deepEqual(
      await wsd.addChannel(clientId1, 'abc'),
      ['abc'],
    )

    deepEqual(
      await wsd.addChannel(clientId1, 'abc'),
      ['abc'],
    )
  })

  it('addChannel() 3 channels', async () => {
    const result1 = await wsd.addChannel(clientId2, 'abc')
    deepEqual(result1, ['abc'])

    const result2 = await wsd.addChannel(clientId2, 'xyz')
    deepEqual(result2, ['abc', 'xyz'])

    const result3 = await wsd.addChannel(clientId2, 'lmn')
    deepEqual(result3, ['abc', 'xyz', 'lmn'])
  })

  it('addChannel() validation', async () => {
    await rejects(() => wsd.addChannel(clientId1, ''), (err) => {
      return err instanceof Error && err.message === 'Empty channel is not allowed'
    })
  })

  it('removeChanel()', async () => {
    const result1 = await wsd.addChannel(clientId3, 'abc')
    deepEqual(result1, ['abc'])

    const result2 = await wsd.removeChannel(clientId3, 'abc')
    deepEqual(result2, [])

    const result3 = await wsd.removeChannel(clientId3, 'abc')
    deepEqual(result3, [])
  })

  it('removeChannel() validation', async () => {
    await rejects(() => wsd.removeChannel(clientId1, ''), (err) => {
      return err instanceof Error && err.message === 'Empty channel is not allowed'
    })
  })
 
})
