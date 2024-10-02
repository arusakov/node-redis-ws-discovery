import { Redis } from "ioredis"

import { WSDiscovery } from "../src"
import { ID } from "../src/constants"

export const createRedis = () => {

  return new Redis({
    lazyConnect: true,
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
  })
}

export const sleep = (ms: number) => new Promise((resolve) => {
  setTimeout(resolve, ms)
})

export const clearRedis = async (redis: Redis, prefix: string) => {
  let cursor = '0'
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', prefix + '*')

    if (keys.length) {
      await redis.del(...keys)
    }
    cursor = nextCursor
  } while (cursor !== '0')
}

export class WSDiscoveryForTests extends WSDiscovery {
  setServerId(id: number) {
    return this.redis.set(`${this.prefixServer}${ID}`, id)
  }

  setClientId(id: number) {
    return this.redis.set(`${this.prefixClient}${ID}`, id)
  }

  getServerTTL(id: number) {
    return this.redis.ttl(this.getServerKey(id))
  }

  getClientTTL(id: number) {
    return this.redis.ttl(this.getClientKey(id))
  }
}