import type { Redis } from 'ioredis'

import { CHNL, SCKT, ID, IP, SID, SRVR, TTL_DEFAULT } from './constants.ts'
import { SCRIPTS, unlock } from './lua.ts'
import { escapeTag, parseSocketFields, sleep } from './utils.ts'
import type { LockOpts, ScriptCommands, Socket, SocketWithServer, WSDiscoveryOptions } from './types.ts'
import { assertChannel, assertSocketFields, assertTTL } from './asserts.ts'

export type { Socket, SocketWithServer, WSDiscoveryOptions } from './types.ts'

type AggregateResponse = [[number, ...Array<[string, string]>], number]

export class WSDiscovery {
  readonly prefix: string
  readonly prefixServer: string
  readonly prefixSocket: string
  readonly ttlServer: number
  readonly ttlSocket: number

  readonly indexScktChnl: string
  // case insensitive index of the first version, it is dropped by the migration
  protected readonly indexScktChnlLegacy: string

  protected readonly redis: Redis & ScriptCommands

  constructor({
    redis,
    ttl = TTL_DEFAULT,
    prefix = 'wsd',
  }: WSDiscoveryOptions) {
    assertTTL(ttl.server)
    this.ttlServer = ttl.server ?? TTL_DEFAULT.server
    assertTTL(ttl.socket)
    this.ttlSocket = ttl.socket ?? TTL_DEFAULT.socket

    this.redis = redis as Redis & ScriptCommands

    this.prefix = `${prefix}:`
    this.prefixServer = `${this.prefix}${SRVR}:`
    this.prefixSocket = `${this.prefix}${SCKT}:`

    this.indexScktChnlLegacy = `${this.prefix}__idx_${SCKT}_${CHNL}`
    this.indexScktChnl = `${this.indexScktChnlLegacy}_v2`
  }

  async connect() {
    this.defineCommands()
    await this.migrate()
  }

  async registerServer(serverIp: string, ttl?: number) {
    assertTTL(ttl)

    const serverIdKey = `${this.prefixServer}${ID}`
    const serverId = await this.redis.incWithReset(serverIdKey)

    await this.redis.hsetWithTTL(
      this.getServerKey(serverId),
      ttl ?? this.ttlServer,
      IP, serverIp,
    )

    return serverId
  }

  async updateServerTTL(serverId: number, ttl?: number) {
    assertTTL(ttl)
    const updated = await this.redis.expire(this.getServerKey(serverId), ttl ?? this.ttlServer)
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

    await this.redis.hsetWithTTL(
      this.getSocketKey(socketId),
      ttl ?? this.ttlSocket,
      SRVR, serverId,
      SID, sessionId,
      CHNL, ',',
    )

    return socketId
  }

  /**
   * @returns requested fields or `null` if the socket does not exist (or expired)
   */
  async getSocket<F extends keyof Socket>(socketId: number, ...fields: F[]): Promise<Pick<Socket, F> | null> {
    assertSocketFields(fields)

    const values = await this.redis.hmget(this.getSocketKey(socketId), ...fields)
    if (values.includes(null)) {
      return null
    }

    return parseSocketFields(fields, values as string[])
  }

  async updateSocketTTL(socketId: number, ttl?: number) {
    assertTTL(ttl)
    const updated = await this.redis.expire(this.getSocketKey(socketId), ttl ?? this.ttlSocket)
    return updated === 1
  }

  async deleteSocket(socketId: number) {
    const deleted = await this.redis.del(this.getSocketKey(socketId))
    return deleted === 1
  }

  /**
   * @returns `true` if the channel was added, `false` if it was already there or the socket does not exist
   */
  async addChannel(socketId: number, channel: string) {
    assertChannel(channel)

    const added = await this.redis.channelAdd(this.getSocketKey(socketId), CHNL, channel)
    return added === 1
  }

  /**
   * Atomically adds channels.
   * @returns `true` if every channel was added
   */
  async addChannels(socketId: number, ...channels: string[]) {
    channels.forEach(assertChannel)
    if (!channels.length) {
      return true
    }

    const added = await this.redis.channelAdd(this.getSocketKey(socketId), CHNL, ...channels)
    return added === channels.length
  }

  /**
   * @returns `true` if the channel was removed, `false` if it was not there or the socket does not exist
   */
  async removeChannel(socketId: number, channel: string) {
    assertChannel(channel)

    const removed = await this.redis.channelRemove(this.getSocketKey(socketId), CHNL, channel)
    return removed === 1
  }

  /**
   * Atomically removes channels.
   * @returns `true` if every channel was removed
   */
  async removeChannels(socketId: number, ...channels: string[]) {
    channels.forEach(assertChannel)
    if (!channels.length) {
      return true
    }

    const removed = await this.redis.channelRemove(this.getSocketKey(socketId), CHNL, ...channels)
    return removed === channels.length
  }

  async getSocketsByChannel(channel: string, batch = 100): Promise<SocketWithServer[]> {
    const keys = await this.getKeysByChannel(channel, batch)
    const results = await this.pipeline(keys.map((key) => ['hget', key, SRVR]))

    const sockets: SocketWithServer[] = []

    keys.forEach((key, index) => {
      const [err, serverId] = results[index]
      if (err || serverId === null) {
        return
      }

      sockets.push({
        [SCKT]: this.getSocketIdFromKey(key),
        [SRVR]: Number(serverId),
      })
    })

    return sockets
  }

  async getSocketSidsByChannel(channel: string, batch = 100): Promise<number[]> {
    const keys = await this.getKeysByChannel(channel, batch)
    const results = await this.pipeline(keys.map((key) => ['hget', key, SID]))

    const sessionIds: number[] = []

    for (const [err, sessionId] of results) {
      if (err || sessionId === null) {
        continue
      }

      sessionIds.push(Number(sessionId))
    }

    return sessionIds
  }

  async getSocketData(socketId: number): Promise<[number, string] | null> {
    const [sessionId, channels] = await this.redis.hmget(this.getSocketKey(socketId), SID, CHNL)

    if (sessionId === null || channels === null) {
      return null
    }

    // Remove surrounding commas
    return [Number(sessionId), channels.slice(1, -1)]
  }

  async getSocketFieldsByChannel<F extends keyof Socket>(
    channel: string,
    batch = 100,
    ...fields: F[]
  ): Promise<Array<[number, Pick<Socket, F>]>> {
    assertSocketFields(fields)

    const keys = await this.getKeysByChannel(channel, batch)
    const results = await this.pipeline(keys.map((key) => ['hmget', key, ...fields]))

    const sockets: Array<[number, Pick<Socket, F>]> = []

    keys.forEach((key, index) => {
      const [err, values] = results[index] as [Error | null, Array<string | null>]
      if (err || values.includes(null)) {
        return
      }

      sockets.push([
        this.getSocketIdFromKey(key),
        parseSocketFields(fields, values as string[]),
      ])
    })

    return sockets
  }

  protected getServerKey(serverId: number) {
    return this.prefixServer + serverId
  }

  protected getSocketKey(socketId: number) {
    return this.prefixSocket + socketId
  }

  protected getSocketIdFromKey(key: string) {
    return Number(key.substring(this.prefixSocket.length))
  }

  protected getMigrationsKey() {
    return this.prefix + '__migrations'
  }

  protected getMigrationsLockKey() {
    return this.getMigrationsKey() + '_lock'
  }

  /**
   * @returns redis keys of the sockets that are in the channel
   */
  protected async getKeysByChannel(channel: string, batch: number) {
    assertChannel(channel)

    let response = await this.redis.call(
      'FT.AGGREGATE',
      this.indexScktChnl,
      `@${CHNL}:{${escapeTag(channel)}}`,
      'LOAD', 1, '@__key',
      'WITHCURSOR',
      'COUNT', batch,
    ) as AggregateResponse

    const keys: string[] = []

    while (true) {
      const [[_count, ...rows], cursor] = response

      for (const [_name, key] of rows) {
        keys.push(key)
      }

      if (!cursor) {
        return keys
      }

      response = await this.redis.call(
        'FT.CURSOR', 'READ', this.indexScktChnl, cursor,
      ) as AggregateResponse
    }
  }

  protected async pipeline(commands: string[][]) {
    const results = await this.redis.pipeline(commands).exec()
    // null is possible only for a discarded MULTI, not for a pipeline
    return results as Array<[Error | null, unknown]>
  }

  protected async lock({
    attempts,
    key,
    sleepMs,
    token,
    ttlMs,
  }: LockOpts) {
    for (let i = 0; i < attempts; ++i) {
      const result = await this.redis.set(key, token, 'PX', ttlMs, 'NX')
      if (result) {
        return
      }

      await sleep(sleepMs)
    }
    throw new Error(`can not take redis lock on key=${key}`)
  }

  protected async unlock(key: string, token: string) {
    await this.redis.eval(unlock, 1, key, token)
  }

  protected defineCommands() {
    for (const [name, { lua, numberOfKeys }] of Object.entries(SCRIPTS)) {
      this.redis.defineCommand(name, { lua, numberOfKeys })
    }
  }

  protected async getIndexInfo(index: string) {
    const indexes = await this.redis.call('FT._LIST') as string[]
    if (!indexes.includes(index)) {
      return null
    }

    // flat array: [name1, value1, name2, value2, ...]
    const flat = await this.redis.call('FT.INFO', index) as unknown[]
    const info: Record<string, unknown> = {}
    for (let i = 0; i < flat.length; i += 2) {
      info[flat[i] as string] = flat[i + 1]
    }

    return info
  }

  // m1: channels are case sensitive, so the index is case sensitive too
  protected async migrateIndexCreate() {
    if (!await this.getIndexInfo(this.indexScktChnl)) {
      await this.redis.call(
        'FT.CREATE', this.indexScktChnl,
        'PREFIX', 1, this.prefixSocket,
        'SCHEMA', CHNL, 'TAG', 'CASESENSITIVE',
      )
    }

    // search results are not complete until the indexing is finished
    while (true) {
      const { indexing } = (await this.getIndexInfo(this.indexScktChnl))!
      if (Number(indexing) === 0) {
        return
      }
      await sleep(100)
    }
  }

  // m2: hashes are not deleted, only the index is dropped
  protected async migrateIndexDropLegacy() {
    if (await this.getIndexInfo(this.indexScktChnlLegacy)) {
      await this.redis.call('FT.DROPINDEX', this.indexScktChnlLegacy)
    }
  }

  protected async migrate() {
    // m0 created the legacy index in the first version, the id is not used anymore
    const migrations: Array<[string, () => Promise<void>]> = [
      ['m1', () => this.migrateIndexCreate()],
      ['m2', () => this.migrateIndexDropLegacy()],
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

    try {
      const migrationsKey = this.getMigrationsKey()

      for (const [migrationId, migration] of migrations) {
        if (await this.redis.sismember(migrationsKey, migrationId)) {
          continue
        }

        // The migration is marked as applied only after it has succeeded
        await migration()
        await this.redis.sadd(migrationsKey, migrationId)
      }
    } finally {
      await this.unlock(lockKey, token)
    }
  }
}
