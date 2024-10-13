import { equal, rejects } from 'assert/strict'
import { describe, it, before, after } from 'node:test'

import { MAX_INT_ID } from '../src/constants'

import { clearRedis, createRedis, sleep, WSDiscoveryForTests } from './utils'

describe('Client', () => {
  const redis = createRedis()
  const wsd = new WSDiscoveryForTests({
    redis,
  })

  const ip1 = '1.1.1.1'
  const ip2 = '1.1.1.2'
  let serverId1: number
  let serverId2: number

  before(async () => {
    await wsd.connect()

    serverId1 = await wsd.registerServer(ip1)
    serverId2 = await wsd.registerServer(ip2)
  })

  after(async () => {
    await clearRedis(redis, wsd.prefix)
    await redis.quit()
  })


  it('registerClient() OK', async () => {
    const cid = await wsd.registerClient(serverId1, 1)
    equal(typeof cid, 'number')

    const serverId = await wsd.getServerIdByClientId(cid)
    equal(serverId, serverId1)
  })

  it('registerClient() twice', async () => {
    const cid1 = await wsd.registerClient(serverId1, 1)
    const cid2 = await wsd.registerClient(serverId2, 2)
    
    equal(cid1 + 1, cid2)
  })


  it('registerClient() bad ttl', async () => {
    await rejects(() => wsd.registerClient(serverId1, 1, 0), (e: Error) => {
      return e instanceof Error && e.message === 'ttl must be > 0 (ttl=0)'
    })  
  })

  it('registerClient() id restarting', async () => {
    await wsd.setClientId(MAX_INT_ID)
    await wsd.registerClient(serverId1, 1)

    const newId = await wsd.registerClient(serverId2, 2)
    equal(newId, 1)  
  })

  it('updateClientTTL()', async () => {
    const cid = await wsd.registerClient(serverId1, 11)

    const result = await wsd.updateClientTTL(cid, 1000)
    equal(result, true)

    const ttl = await wsd.getClientTTL(cid)

    equal(ttl > 1000 * 0.99, true)
    equal(ttl <= 1000, true)
  })

  it('updateClientTTL() expired', async () => {
    const cid = 999

    const result = await wsd.updateClientTTL(cid, 10)

    equal(result, false)
  })

  it('updateClientTTL() bad ttl', async () => {
    await rejects(() => wsd.updateClientTTL(1, 0), (e: Error) => {
      return e instanceof Error && e.message === 'ttl must be > 0 (ttl=0)'
    })
    
    await rejects(() => wsd.updateClientTTL(1, -1), (e: Error) => {
      return e instanceof Error && e.message === 'ttl must be > 0 (ttl=-1)'
    })
  })

  it('client ttl expires', async () => {
    const cid = await wsd.registerClient(serverId1, 1, 1)
    equal(await wsd.getServerIdByClientId(cid), serverId1)
    
    await sleep(1000)
    equal(await wsd.getServerIdByClientId(cid), 0)
  })

  it('delete client', async () => {
    const cid = await wsd.registerClient(serverId2, 2, 2)

    equal(await wsd.getServerIdByClientId(cid), serverId2)
    equal(await wsd.deleteClient(cid), true)
    equal(await wsd.getServerIdByClientId(cid), 0)
  })
})
