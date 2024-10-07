import type { Redis } from 'ioredis'
import { CHNL, CLNT, ID, IP, MAX_INT_ID, SID, SRVR, TTL_DEFAULT } from './constants'

export type WSDiscoveryOptions = {
  redis: Redis
  prefix?: string
  ttl?: {
    server?: number
    client?: number
  }
}



const assertTTL = (ttl?: number): void | never => {
  if (ttl != null && ttl <= 0) {
    throw new Error(`ttl must be > 0 (ttl=${ttl})`)
  }
}

const assertChannel = (channel: string): void | never => {
  if (!channel.length) {
    throw new Error('Empty channel is not allowed')
  }
}

export class WSDiscovery {

  protected readonly redis: Redis

  protected readonly ttlServer: number
  protected readonly ttlClient: number
  
  protected readonly prefixServer: string
  protected readonly prefixClient: string

  constructor({
    redis,
    ttl = TTL_DEFAULT,
    prefix = 'wsd',
  }: WSDiscoveryOptions) {
    this.redis = redis
    
    assertTTL(ttl.server)
    this.ttlServer = ttl.server || TTL_DEFAULT.server
    assertTTL(ttl.client)
    this.ttlClient = ttl.client || TTL_DEFAULT.client

    this.prefixServer = `${prefix}:${SRVR}:`
    this.prefixClient = `${prefix}:${CLNT}:`
  }

  async connect() {
    await this.redis.ping()

    const list = await this.listIndexes()
    console.log(list)
    // TODO load lua to redis

    // await this.redis.call(`FT.CREATE ${this.prefixClient}:index_${CHNL} PREFIX 1 ${this.prefixClient}:${CLNT}: SCHEMA ${CHNL} TAG`)
  }

  async registerServer(serverIp: string, ttl?: number) {
    assertTTL(ttl)
    
    const serverIdKey = `${this.prefixServer}${ID}`

    const serverId = await this.redis.incr(serverIdKey)
    if (serverId >= MAX_INT_ID) {
      await this.redis.set(serverIdKey, 0)
    }

    const serverKey = this.getServerKey(serverId)

    await this.redis.hset(serverKey, {
      [IP]: serverIp,
    })
    await this.redis.expire(serverKey, ttl || this.ttlServer)

    return serverId
  }

  async updateServerTTL(serverId: number, ttl?: number) {
    assertTTL(ttl)
    const updated = await this.redis.expire(this.getServerKey(serverId), ttl || this.ttlServer)
    return updated === 1
  }

  getServerIp(serverId: number) {
    return this.redis.hget(this.getServerKey(serverId), IP)
  }

  //
  // There is not delete server, becase ttl is used
  //

  async registerClient(serverId: number, sessionId: number, ttl?: number) {
    assertTTL(ttl)

    const clientIdKey = `${this.prefixClient}${ID}`
    const clientId = await this.redis.incr(clientIdKey)
    if (clientId >= MAX_INT_ID) {
      await this.redis.set(clientIdKey, 0)
    }

    const clientKey = this.getClientKey(clientId)

    await this.redis.hset(clientKey, {
      [SRVR]: serverId,
      [SID]: sessionId,
      [CHNL]: '',
    })
    await this.redis.expire(clientKey, ttl || this.ttlClient)

    return clientId
  }

  /**
   * 
   * @returns 
   * 0 - if client is not
   */
  async getServerIdByClientId(clientId: number) {
    const serverId = await this.redis.hget(this.getClientKey(clientId), SRVR)
    return Number(serverId)
  }

  async updateClientTTL(clientId: number, ttl?: number) {
    assertTTL(ttl)
    const updated = await this.redis.expire(this.getClientKey(clientId), ttl || this.ttlClient)
    return updated === 1
  }

  async deleteClient(clientId: number) {
    const deleted = await this.redis.del(this.getClientKey(clientId))
    return deleted === 1
  }

  protected getServerKey(serverId: number) {
    return this.prefixServer + serverId
  }

  async addChannel(clientId: number, channel: string) {
    assertChannel(channel)

    const script = 
      `
        local key = KEYS[1]
        local chnl_key = ARGV[1]
        local chnl_arg = ARGV[2]
        local chnl_str = redis.call('HGET', key, chnl_key)

        local chnl = {}
        for match in chnl_str:gmatch('([^,]+)') do
          table.insert(chnl, match)
        end

        local exists = false
        for _, c in ipairs(chnl) do
          if c == chnl_arg then
            exists = true
            break
          end
        end

        if exists then
          return chnl
        end

        table.insert(chnl, chnl_arg)
        redis.call('HSET', key, chnl_key, table.concat(chnl, ','))      

        return chnl
      `.trim()

    return this.redis.eval(
      script,
      1,
      [this.getClientKey(clientId), CHNL, channel],
    )
  }

  async removeChannel(clientId: number, channel: string) {
    assertChannel(channel)
 
    const script = 
      `
        local key = KEYS[1]
        local chnl_key = ARGV[1]
        local chnl_arg = ARGV[2]
        local chnl_str = redis.call('HGET', key, chnl_key)

        local chnl = {}
        for match in chnl_str:gmatch('([^,]+)') do
          if match ~= chnl_arg then
            table.insert(chnl, match)
          end
        end

        redis.call('HSET', key, chnl_key, table.concat(chnl, ','))      

        return chnl
      `
        .trim()

    return this.redis.eval(
      script,
      1,
      [this.getClientKey(clientId), CHNL, channel],
    )
  }

  protected getClientKey(clientId: number) {
    return this.prefixClient + clientId
  }

  protected listIndexes() {
    return this.redis.call('FT._LIST')
  }

}