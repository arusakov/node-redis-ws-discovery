import { equal, rejects, deepEqual } from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'

import { clearRedis, createRedis, sleep, WSDiscoveryForTests } from './utils.ts'
import { ID_MAX, SRVR } from '../src/constants.ts'

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

    deepEqual(await wsd.getSocket(cid, SRVR), { [SRVR]: serverId1 })
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
    await wsd.setSocketId(ID_MAX - 1)

    equal(await wsd.registerSocket(serverId1, 1), ID_MAX)
    equal(await wsd.registerSocket(serverId2, 2), 1)
    equal(await wsd.registerSocket(serverId2, 2), 2)
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
    equal(await wsd.getSocket(cid, SRVR), null)
  })

  it('delete socket', async () => {
    const cid = await wsd.registerSocket(serverId2, 2, 2)

    deepEqual(await wsd.getSocket(cid, SRVR), { [SRVR]: serverId2 })
    equal(await wsd.deleteSocket(cid), true)
    equal(await wsd.getSocket(cid, SRVR), null)
  })
})
