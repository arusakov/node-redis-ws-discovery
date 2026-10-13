import { Redis } from 'ioredis'

import { WSDiscovery } from '../src/index.ts'
import { ID } from '../src/constants.ts'

export const createRedis = () => {
  return new Redis({
    lazyConnect: true,
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT) || undefined,
  })
}

export const sleep = (ms: number) => new Promise((resolve) => {
  setTimeout(resolve, ms)
})

export const clearRedis = async (redis: Redis, prefix: string) => {
  let cursor = '0'
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', prefix + '*')

    const keysForDelete = keys.filter((k) => !k.startsWith(prefix + '__'))
    if (keysForDelete.length) {
      await redis.del(...keysForDelete)
    }
    cursor = nextCursor
  } while (cursor !== '0')
}

export class WSDiscoveryForTests extends WSDiscovery {
  // redis keys that are added to the result of the search by channel (stale or broken keys)
  extraKeys: string[] = []

  // number of getIndexInfo() calls that report the running indexing
  indexingPolls = 0

  protected override async getIndexInfo(index: string) {
    const info = await super.getIndexInfo(index)
    if (info && this.indexingPolls > 0) {
      --this.indexingPolls
      return { ...info, indexing: '1' }
    }
    return info
  }

  protected override async getKeysByChannel(channel: string, batch: number) {
    return [...await super.getKeysByChannel(channel, batch), ...this.extraKeys]
  }

  getLegacyIndexName() {
    return this.indexScktChnlLegacy
  }

  getSocketKeyForTests(socketId: number) {
    return this.getSocketKey(socketId)
  }

  getRedis() {
    return this.redis
  }

  setServerId(id: number) {
    return this.redis.set(`${this.prefixServer}${ID}`, id)
  }

  setSocketId(id: number) {
    return this.redis.set(`${this.prefixSocket}${ID}`, id)
  }

  getServerTTL(id: number) {
    return this.redis.ttl(this.getServerKey(id))
  }

  getSocketTTL(id: number) {
    return this.redis.ttl(this.getSocketKey(id))
  }

  lockForTests(ttlMs: number) {
    return this.lock({
      attempts: 5,
      key: this.getMigrationsLockKey(),
      sleepMs: 100,
      token: 'test',
      ttlMs,
    })
  }
}