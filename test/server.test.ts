import { equal, rejects } from 'assert/strict'
import { describe, it, before, after } from 'node:test'

import { MAX_INT_ID } from './utils'

import { clearRedis, createRedis, sleep, WSDiscoveryForTests } from './utils'

describe('Server', () => {
  const redis = createRedis()
  const wsd = new WSDiscoveryForTests({
    redis,
  })

  before(async () => {
    await wsd.connect()
  })

  after(async () => {
    await clearRedis(redis, wsd.prefix)
    await redis.quit()
  })

  const ip1 = '1.1.1.1'
  const ip2 = '1.1.1.2'

  it('registerServer() OK', async () => {
    const sid = await wsd.registerServer(ip1)
    
    equal(typeof sid, 'number')

    const ip = await wsd.getServerIp(sid)
    equal(ip, ip1)
  })

  it('registerServer() twice', async () => {
    const sid1 = await wsd.registerServer(ip1)
    const sid2 = await wsd.registerServer(ip2)
    
    equal(sid1 + 1, sid2)
  })


  it('registerServer() bad ttl', async () => {
    await rejects(() => wsd.registerServer('', 0), (e: Error) => {
      return e instanceof Error && e.message === 'ttl must be > 0 (ttl=0)'
    })
    await rejects(() => wsd.registerServer('', -1), (e: Error) => {
      return e instanceof Error && e.message === 'ttl must be > 0 (ttl=-1)'
    }) 
  })

  it('registerServer() id restarting', async () => {
    await wsd.setServerId(MAX_INT_ID)
    await wsd.registerServer('abc')

    const newId = await wsd.registerServer('bcd')
    equal(newId, 1)  
  })

  it('updateServerTTL()', async () => {
    const sid = await wsd.registerServer('1')

    await wsd.updateServerTTL(sid, 1000)

    const ttl = await wsd.getServerTTL(sid)

    equal(ttl > 1000 * 0.99, true)
    equal(ttl <= 1000, true)
  })

  it('updateServerTTL() expired', async () => {
    const sid = 999

    const result = await wsd.updateServerTTL(sid, 10)

    equal(result, false)
  })

  it('updateServerTTL() bad ttl', async () => {
    await rejects(() => wsd.updateServerTTL(1, 0), (e: Error) => {
      return e instanceof Error && e.message === 'ttl must be > 0 (ttl=0)'
    })
    await rejects(() => wsd.updateServerTTL(1, -1), (e: Error) => {
      return e instanceof Error && e.message === 'ttl must be > 0 (ttl=-1)'
    }) 
  })

  it('server ttl expires', async () => {
    const sid = await wsd.registerServer(ip1, 1)
    equal(await wsd.getServerIp(sid), ip1)

    await sleep(1000)
    equal(await wsd.getServerIp(sid), null)
  })
})
