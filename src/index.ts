import type { Callback, Redis, Result } from 'ioredis'
import { CHNL, CLNT, ID, IP, MAX_INT_ID, SID, SRVR, TTL_DEFAULT } from './constants'
import { sleep } from './utils'

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

// Add declarations
declare module "ioredis" {
  interface RedisCommander<Context> {
    myecho(
      key: string,
      argv: string,
      callback?: Callback<string>
    ): Result<string, Context>;
  }
}

export class WSDiscovery {
  readonly prefix: string
  readonly prefixServer: string
  readonly prefixClient: string
  readonly ttlServer: number
  readonly ttlClient: number
  
  protected readonly redis: Redis

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

    this.prefix = `${prefix}:`
    this.prefixServer = `${this.prefix}${SRVR}:`
    this.prefixClient = `${this.prefix}${CLNT}:`
  }

  async connect() {
    await this.redis.ping()
    await this.migrate()
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

  protected async lock(key: string, token: string) {

    for (let i = 0; i < 1000; ++i) {
      const result = await this.redis.set(key, token, 'EX', 30, 'NX')
      if (result) {
        return
      }

      console.log(result)
      await sleep(500)
    }
    throw new Error(`can not take redis lock on key=${key}`)  
  }

  protected async unlock(key: string, token: string) {
    await this.redis.eval(`
      if redis.call("get",KEYS[1]) == ARGV[1] then
          return redis.call("del",KEYS[1])
      else
          return 0
      end
    `, 1, key, token)
  }

  protected async migrate() {
    const migrations: Array<[string, string[]]> = [
      ['FT.CREATE', `${this.prefix}__index_${CLNT}_${CHNL} PREFIX 1 ${this.prefixClient} SCHEMA ${CHNL} TAG`.split(' ')],
    ]

    const token = `${Date.now()}_${Math.floor(Math.random() * 99999999)}`
    const migrationsKey = this.prefix + '__migrations'
    const lockKey = migrationsKey + '_lock'

    await this.lock(lockKey, token)

    for (let i = 0; i < migrations.length; ++i) {
      const migration = migrations[i]

      await this.redis.call(migration[0], migration[1])
      await this.redis.sadd(migrationsKey, 'm' + i)
    }
    await this.unlock(lockKey, token)
  }

}