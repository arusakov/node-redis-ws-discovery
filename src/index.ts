import { readFile } from 'fs/promises'
import { resolve } from 'path'

import type { Redis } from 'ioredis'

import { CHNL, SCKT, ID, IP, LUA, SID, SRVR, TTL_DEFAULT, CustomScripts } from './constants'
import { sleep } from './utils'
import { SocketWithServer, LockOpts, WSDiscoveryOptions, type Socket } from './types'
import { assertChannel, assertSocketFields, assertTTL } from './asserts'


export class WSDiscovery {
  readonly prefix: string
  readonly prefixServer: string
  readonly prefixSocket: string
  readonly ttlServer: number
  readonly ttlSocket: number
  
  readonly indexScktChnl: string
  
  protected readonly redis: Redis

  constructor({
    redis,
    ttl = TTL_DEFAULT,
    prefix = 'wsd',
  }: WSDiscoveryOptions) {
    assertTTL(ttl.server)
    this.ttlServer = ttl.server || TTL_DEFAULT.server
    assertTTL(ttl.socket)
    this.ttlSocket = ttl.socket || TTL_DEFAULT.socket

    this.redis = redis

    this.prefix = `${prefix}:`
    this.prefixServer = `${this.prefix}${SRVR}:`
    this.prefixSocket = `${this.prefix}${SCKT}:`

    this.indexScktChnl = `${this.prefix}__idx_${SCKT}_${CHNL}`
  }

  async connect() {
    await this.defineCommands()
    await this.migrate()
  }

  async registerServer(serverIp: string, ttl?: number) {
    assertTTL(ttl)
    
    const serverIdKey = `${this.prefixServer}${ID}`
    const serverId = await this.redis.incWithReset(serverIdKey)

    const serverKey = this.getServerKey(serverId)
    await this.redis.hsetWithTTL(
      serverKey,
      ttl || this.ttlServer,
      IP, serverIp,
    )

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

  async registerSocket(serverId: number, sessionId: number, ttl?: number) {
    assertTTL(ttl)

    const socketIdKey = `${this.prefixSocket}${ID}`
    const socketId = await this.redis.incWithReset(socketIdKey)

    const socketKey = this.getSocketKey(socketId)
    await this.redis.hsetWithTTL(
      socketKey,
      ttl || this.ttlSocket,
      SRVR, serverId,
      SID, sessionId,
      CHNL, ',',
    )

    return socketId
  }


  async getSocket<F extends keyof Socket>(socketId: number, ...fields: F[]): Promise<Pick<Socket, F>> {
    assertSocketFields(fields)

    const values = await this.redis.hmget(this.getSocketKey(socketId), ...fields)
    
    return fields.reduce((acc, cur, ind) => {
      const value = values[ind]
      if (cur === CHNL) {
        // @ts-expect-error
        acc[cur] = value.split(',').slice(1, -1)
      } else {
        // @ts-expect-error
        acc[cur] = Number(value)
      }
      return acc
    }, {} as Pick<Socket, F>)
  }

  async updateSocketTTL(socketId: number, ttl?: number) {
    assertTTL(ttl)
    const updated = await this.redis.expire(this.getSocketKey(socketId), ttl || this.ttlSocket)
    return updated === 1
  }

  async deleteSocket(socketId: number) {
    const deleted = await this.redis.del(this.getSocketKey(socketId))
    return deleted === 1
  }

  protected getServerKey(serverId: number) {
    return this.prefixServer + serverId
  }

  async addChannel(socketId: number, channel: string) {
    assertChannel(channel)

    const result = await this.redis.channelAdd(this.getSocketKey(socketId), CHNL, channel)
    return result === 1
  }

  async addChannels(socketId: number, ...channels: string[]): Promise<boolean> {
    if (channels.length === 0) return true
    
    channels.forEach(assertChannel)

    let success = true
    for (const channel of channels) {
      const result = await this.redis.channelAdd(this.getSocketKey(socketId), CHNL, channel)
      if (result !== 1) {
        success = false
      }
    }
    return success
  }

  async removeChannel(socketId: number, channel: string) {
    assertChannel(channel)
 
    const result = await this.redis.channelRemove(this.getSocketKey(socketId), CHNL, channel)
    return result === 1
  }

  async removeChannels(socketId: number, ...channels: string[]): Promise<boolean> {
    if (channels.length === 0) return true
    
    channels.forEach(assertChannel)

    let success = true
    for (const channel of channels) {
      const result = await this.redis.channelRemove(this.getSocketKey(socketId), CHNL, channel)
      if (result !== 1) {
        success = false
      }
    }
    return success
  }

  async getSocketsByChannel(channel: string, batch = 100): Promise<SocketWithServer[]> {
    assertChannel(channel)

    type KeyAndKey = ['__key', string]
    type AggregateAndCursorResponse = [[1, ...KeyAndKey[]], number]

    let [aggregateResult, cursor] = await this.redis.call(
      'FT.AGGREGATE',
      this.indexScktChnl,
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
        'FT.CURSOR', 'READ', this.indexScktChnl, cursor
      ) as AggregateAndCursorResponse
    }

    const hgetResults = await this.redis.pipeline(
      keys.map((k) => ['hget', k, SRVR]),
    ).exec()

    if (!hgetResults) {
      throw new Error('multiple hget error')
    }

    const results: SocketWithServer[] = []

    for (const [index, key] of keys.entries()) {
      const [err, serverId] = hgetResults[index]

      if (err) {
        continue
      }

      results.push({
        [SCKT]: Number(key.substring(this.prefixSocket.length)),
        [SRVR]: Number(serverId),
      })
    }    

    return results
  }

  async getSocketSidsByChannel(channel: string, batch = 100): Promise<number[]> {
    assertChannel(channel)

    type KeyAndKey = ['__key', string]
    type AggregateAndCursorResponse = [[1, ...KeyAndKey[]], number]

    let [aggregateResult, cursor] = await this.redis.call(
      'FT.AGGREGATE',
      this.indexScktChnl,
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
        'FT.CURSOR', 'read', this.indexScktChnl, cursor
      ) as AggregateAndCursorResponse
    }

    const hgetResults = await this.redis.pipeline(
      keys.map((k) => ['hget', k, SID]),
    ).exec()

    if (!hgetResults) {
      throw new Error('multiple hget error')
    }

    const results: number[] = []

    for (const [index] of keys.entries()) {
      const [err, sessionId] = hgetResults[index]

      if (err || !sessionId) {
        continue
      }

      results.push(Number(sessionId))
    }

    return results
  }

  async getSocketData(socketId: number): Promise<[number, string] | null> {
    const values = await this.redis.hmget(this.getSocketKey(socketId), SID, CHNL)
    
    if (!values || values[0] === null || values[1] === null) {
      return null
    }

    const sessionId = Number(values[0])
    const channelsString = values[1].split(',').slice(1, -1).join(',') // Remove surrounding commas
    
    return [sessionId, channelsString]
  }

  async getSocketFieldsByChannel<F extends keyof Socket>(channel: string, batch = 100, ...fields: F[]): Promise<Array<[number, Pick<Socket, F>]>> {
    assertChannel(channel)
    assertSocketFields(fields)

    type KeyAndKey = ['__key', string]
    type AggregateAndCursorResponse = [[1, ...KeyAndKey[]], number]

    let [aggregateResult, cursor] = await this.redis.call(
      'FT.AGGREGATE',
      this.indexScktChnl,
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
        'FT.CURSOR', 'read', this.indexScktChnl, cursor
      ) as AggregateAndCursorResponse
    }

    const hmgetResults = await this.redis.pipeline(
      keys.map((k) => ['hmget', k, ...fields]),
    ).exec()

    if (!hmgetResults) {
      throw new Error('multiple hmget error')
    }

    const results: Array<[number, Pick<Socket, F>]> = []

    for (const [index, key] of keys.entries()) {
      const [err, values] = hmgetResults[index]

      if (err || !values || (values as any[]).some((v: any) => v === null)) {
        continue
      }

      const socketId = Number(key.substring(this.prefixSocket.length))
      const socketData = fields.reduce((acc, field, fieldIndex) => {
        const value = (values as any[])[fieldIndex]
        if (field === CHNL) {
          (acc as any)[field] = value.split(',').slice(1, -1)
        } else {
          (acc as any)[field] = Number(value)
        }
        return acc
      }, {} as Pick<Socket, F>)

      results.push([socketId, socketData])
    }

    return results
  }

  protected getSocketKey(socketId: number) {
    return this.prefixSocket + socketId
  }

  protected getMigrationsKey() {
    return this.prefix + '__migrations'
  }

  protected getMigrationsLockKey() {
    return this.getMigrationsKey() + '_lock'
  }

  protected async lock({
    attempts, 
    key,
    sleepMs,
    token,
    ttlMs: ttl,
  }: LockOpts) {

    for (let i = 0; i < attempts; ++i) {
      const result = await this.redis.set(key, token, 'PX', ttl, 'NX')
      if (result) {
        return
      }

      await sleep(sleepMs)
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
      },
      [CustomScripts.INC_WITH_RESET]: {
        keys: 1,
        readOnly: false,
      },
      [CustomScripts.HSET_WITH_TTL]: {
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
      ['FT.CREATE', `${this.indexScktChnl} PREFIX 1 ${this.prefixSocket} SCHEMA ${CHNL} TAG`.split(' ')],
    ]

    const token = `${Date.now()}_${Math.floor(Math.random() * 99999999)}`
    const lockKey = this.getMigrationsLockKey()
  
    await this.lock({
      attempts: 60,
      key: lockKey,
      sleepMs: 1_000,
      token,
      ttlMs: 30_000,
    })
    
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