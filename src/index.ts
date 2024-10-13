import { readFile } from 'fs/promises'
import { resolve } from 'path'

import type { Callback, Redis, Result } from 'ioredis'

import { __MIGRATIONS, CHNL, CLNT, ID, IP, LUA, MAX_INT_ID, SID, SRVR, TTL_DEFAULT } from './constants'
import { sleep } from './utils'

export type WSDiscoveryOptions = {
  redis: Redis
  prefix?: string
  ttl?: {
    server?: number
    client?: number
  }
}


export type ClientWithServer = {
  [CLNT]: number
  [SRVR]: number 
}

export type ClientFields =
  | typeof SID
  | typeof CHNL
  | typeof SRVR


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
    channelAdd(
      key: string,
      channelProp: string,
      channel: string,
      callback?: Callback<0 | 1>
    ): Result<0 | 1, Context>;

    channelRemove(
      key: string,
      channelProp: string,
      channel: string,
      callback?: Callback<0 | 1>
    ): Result<0 | 1, Context>;
  }
}

enum CustomScripts {
  CHANNEL_ADD = 'channelAdd',
  CHANNEL_REMOVE = 'channelRemove'
}

export class WSDiscovery {
  readonly prefix: string
  readonly prefixServer: string
  readonly prefixClient: string
  readonly ttlServer: number
  readonly ttlClient: number
  
  readonly indexClntChnl: string
  
  protected readonly redis: Redis

  constructor({
    redis,
    ttl = TTL_DEFAULT,
    prefix = 'wsd',
  }: WSDiscoveryOptions) {
    assertTTL(ttl.server)
    this.ttlServer = ttl.server || TTL_DEFAULT.server
    assertTTL(ttl.client)
    this.ttlClient = ttl.client || TTL_DEFAULT.client

    this.redis = redis

    this.prefix = `${prefix}:`
    this.prefixServer = `${this.prefix}${SRVR}:`
    this.prefixClient = `${this.prefix}${CLNT}:`

    this.indexClntChnl = `${this.prefix}__idx_${CLNT}_${CHNL}`
  }

  async connect() {
    await this.defineCommands()
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

  async getClientServer(clientId: number) {
    const serverId = await this.redis.hget(this.getClientKey(clientId), SRVR)
    return Number(serverId)
  }

  async getClientChannels(clientId: number) {
    const channels = await this.redis.hget(this.getClientKey(clientId), CHNL)
    return channels ? channels.split(',') : []
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

    const result = await this.redis.channelAdd(this.getClientKey(clientId), CHNL, channel)
    return result === 1
  }

  async removeChannel(clientId: number, channel: string) {
    assertChannel(channel)
 
    const result = await this.redis.channelRemove(this.getClientKey(clientId), CHNL, channel)
    return result === 1
  }

  async getClientsByChannel(channel: string, batch = 100): Promise<ClientWithServer[]> {
    assertChannel(channel)

    type KeyAndKey = ['__key', string]
    type AggregateAndCursorResponse = [[1, ...KeyAndKey[]], number]

    let [aggregateResult, cursor] = await this.redis.call(
      'FT.AGGREGATE',
      this.indexClntChnl,
      `@${CHNL}:{${channel}}`,
      'LOAD', 1, '@__key',
      'WITHCURSOR',
      'COUNT', batch,
    ) as AggregateAndCursorResponse

    const keys: string[] = []
  
    while (true) {
      keys.push(...((aggregateResult.slice(1) as KeyAndKey[]).map(([_key, key]) => key)))
      if (!cursor) {
        break
      }

      [aggregateResult, cursor] = await this.redis.call(
        'FT.CURSOR', 'READ', this.indexClntChnl, cursor
      ) as AggregateAndCursorResponse
    }

    const hgetResults = await this.redis.pipeline(
      keys.map((k) => ['hget', k, SRVR]),
    ).exec()

    if (!hgetResults) {
      throw new Error('multiple hget error')
    }

    const results: ClientWithServer[] = []

    for (const [index, key] of keys.entries()) {
      const [err, serverId] = hgetResults[index]

      if (err) {
        continue
      }

      results.push({
        [CLNT]: Number(key.substring(this.prefixClient.length)),
        [SRVR]: Number(serverId),
      })
    }    

    return results
  }

  protected getClientKey(clientId: number) {
    return this.prefixClient + clientId
  }

  protected getMigrationsKey() {
    return this.prefix + '__migrations'
  }

  protected getMigrationsLockKey() {
    return this.getMigrationsKey() + '_lock'
  }

  protected async lock(key: string, token: string, ttl: number) {

    for (let i = 0; i < 60; ++i) {
      const result = await this.redis.set(key, token, 'EX', ttl, 'NX')
      if (result) {
        return
      }

      await sleep(1000)
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

  protected async defineCommands() {
    type ScriptData = {
      keys: number
      readOnly: boolean
    }    
    const scripts: Record<CustomScripts, ScriptData> = {
      [CustomScripts.CHANNEL_ADD]: {
        keys: 1,
        readOnly: false,
      },
      [CustomScripts.CHANNEL_REMOVE]: {
        keys: 1,
        readOnly: false,
      }
    }

    for (const [scriptName, scriptData] of Object.entries(scripts)) {
      this.redis.defineCommand(scriptName, {
        lua: await readFile(resolve(__dirname, '..', LUA, `${scriptName}.${LUA}`), 'utf8'),
        numberOfKeys: scriptData.keys,
        readOnly: scriptData.readOnly,
      })
    }
  }

  protected async migrate() {
    const migrations: Array<[string, string[]]> = [
      ['FT.CREATE', `${this.indexClntChnl} PREFIX 1 ${this.prefixClient} SCHEMA ${CHNL} TAG`.split(' ')],
    ]

    const token = `${Date.now()}_${Math.floor(Math.random() * 99999999)}`
    const lockKey = this.getMigrationsLockKey()
  
    await this.lock(lockKey, token, 30)
    
    const migrationsKey = this.getMigrationsKey()
    for (let i = 0; i < migrations.length; ++i) {
      const migrationId = 'm' + i 
      const applied = await this.redis.sismember(migrationsKey, migrationId)
      if (applied) {
        continue
      }

      const migration = migrations[i]
      // TODO there can be logical errors inside transaction!!
      await this.redis
        .multi()
        .call(migration[0], migration[1])
        .sadd(migrationsKey, migrationId)
        .exec()
    }

    await this.unlock(lockKey, token)
  }

}