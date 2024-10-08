import { strictEqual, rejects } from 'assert'
import { describe, it, before, after } from 'node:test'

import { clearRedis, createRedis, sleep, WSDiscoveryForTests } from './utils'
import { MAX_INT_ID } from '../src/constants'

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
    strictEqual(typeof cid, 'number')

    const serverId = await wsd.getServerIdByClientId(cid)
    strictEqual(serverId, serverId1)
  })

  it('registerClient() twice', async () => {
    const cid1 = await wsd.registerClient(serverId1, 1)
    const cid2 = await wsd.registerClient(serverId2, 2)
    
    strictEqual(cid1 + 1, cid2)
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
    strictEqual(newId, 1)  
  })

  it('updateClientTTL()', async () => {
    const cid = await wsd.registerClient(serverId1, 11)

    const result = await wsd.updateClientTTL(cid, 1000)
    strictEqual(result, true)

    const ttl = await wsd.getClientTTL(cid)

    strictEqual(ttl > 1000 * 0.99, true)
    strictEqual(ttl <= 1000, true)
  })

  it('updateClientTTL() expired', async () => {
    const cid = 999

    const result = await wsd.updateClientTTL(cid, 10)

    strictEqual(result, false)
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
    strictEqual(await wsd.getServerIdByClientId(cid), serverId1)
    
    await sleep(1000)
    strictEqual(await wsd.getServerIdByClientId(cid), 0)
  })

  it('delete client', async () => {
    const cid = await wsd.registerClient(serverId2, 2, 2)

    strictEqual(await wsd.getServerIdByClientId(cid), serverId2)
    strictEqual(await wsd.deleteClient(cid), true)
    strictEqual(await wsd.getServerIdByClientId(cid), 0)
  })
})
