import { equal, rejects, deepEqual } from 'assert/strict'
import { describe, it, before, after } from 'node:test'

import { MAX_INT_ID } from './utils'

import { clearRedis, createRedis, sleep, WSDiscoveryForTests } from './utils'
import { SRVR } from '../src/constants'

describe('Socket', () => {
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


  it('registerSocket() OK', async () => {
    const cid = await wsd.registerSocket(serverId1, 1)
    equal(typeof cid, 'number')

    const { srvr } = await wsd.getSocket(cid, SRVR)
    equal(srvr, serverId1)
  })

  it('registerSocket() twice', async () => {
    const cid1 = await wsd.registerSocket(serverId1, 1)
    const cid2 = await wsd.registerSocket(serverId2, 2)
    
    equal(cid1 + 1, cid2)
  })


  it('registerSocket() bad ttl', async () => {
    await rejects(() => wsd.registerSocket(serverId1, 1, 0), (e: Error) => {
      return e instanceof Error && e.message === 'ttl must be > 0 (ttl=0)'
    })  
  })

  it('registerSocket() id restarting', async () => {
    await wsd.setSocketId(MAX_INT_ID)
    await wsd.registerSocket(serverId1, 1)

    const newId = await wsd.registerSocket(serverId2, 2)
    equal(newId, 1)  
  })

  it('updateSocketTTL()', async () => {
    const cid = await wsd.registerSocket(serverId1, 11)

    const result = await wsd.updateSocketTTL(cid, 1000)
    equal(result, true)

    const ttl = await wsd.getSocketTTL(cid)

    equal(ttl > 1000 * 0.99, true)
    equal(ttl <= 1000, true)
  })

  it('updateSocketTTL() expired', async () => {
    const cid = 999

    const result = await wsd.updateSocketTTL(cid, 10)

    equal(result, false)
  })

  it('updateSocketTTL() bad ttl', async () => {
    await rejects(() => wsd.updateSocketTTL(1, 0), (e: Error) => {
      return e instanceof Error && e.message === 'ttl must be > 0 (ttl=0)'
    })
    
    await rejects(() => wsd.updateSocketTTL(1, -1), (e: Error) => {
      return e instanceof Error && e.message === 'ttl must be > 0 (ttl=-1)'
    })
  })

  it('socket ttl expires', async () => {
    const cid = await wsd.registerSocket(serverId1, 1, 1)
    deepEqual(await wsd.getSocket(cid, SRVR), { [SRVR]: serverId1 })
    
    await sleep(1000)
    deepEqual(await wsd.getSocket(cid, SRVR), { [SRVR]: 0 })
  })

  it('delete socket', async () => {
    const cid = await wsd.registerSocket(serverId2, 2, 2)

    deepEqual(await wsd.getSocket(cid, SRVR), { [SRVR]: serverId2 })
    equal(await wsd.deleteSocket(cid), true)
    deepEqual(await wsd.getSocket(cid, SRVR), { [SRVR]: 0 })
  })
})
