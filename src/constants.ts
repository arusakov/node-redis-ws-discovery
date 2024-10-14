export const TTL_DEFAULT = {
  server: 30,
  client: 120,
}

export const SRVR = 'srvr'
export const CLNT = 'clnt'
export const IP = 'ip'
export const SID = 'sid'
export const ID = 'id'
export const CHNL = 'chnl'
export const LUA = 'lua'

export enum CustomScripts {
  CHANNEL_ADD = 'channelAdd',
  CHANNEL_REMOVE = 'channelRemove',
  INC_WITH_RESET = 'incWithReset',
  HSET_WITH_TTL  = 'hsetWithTTL',
}

