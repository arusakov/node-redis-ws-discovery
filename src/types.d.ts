import type { Redis, Result } from 'ioredis'
import type { CHNL, SCKT, SID, SRVR, CustomScripts } from './constants'

export type WSDiscoveryOptions = {
  redis: Redis
  prefix?: string
  ttl?: {
    server?: number
    socket?: number
  }
}

export type SocketWithServer = {
  [SCKT]: number
  [SRVR]: number 
}

export type Socket = {
  [CHNL]: string[]
  [SID]: number
  [SRVR]: number
}

export type LockOpts = {
  key: string
  token: string
  ttlMs: number
  attempts: number
  sleepMs: number
}

// Add declarations
declare module 'ioredis' {
  interface RedisCommander<Context> {
    [CustomScripts.CHANNEL_ADD](
      key: string,
      channelProp: string,
      channel: string,
    ): Result<0 | 1, Context>

    [CustomScripts.CHANNEL_REMOVE](
      key: string,
      channelProp: string,
      channel: string,
    ): Result<0 | 1, Context>

    [CustomScripts.INC_WITH_RESET](
      key: string,
    ): Result<number, Context>

    [CustomScripts.HSET_WITH_TTL](
      key: string,
      ttl: number,
      ...args: Array<string | number>,      
    ): Result<number, Context>
  }
}