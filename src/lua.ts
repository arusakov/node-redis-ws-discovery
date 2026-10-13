import { ID_MAX } from './constants.ts'

// Channels of a socket are stored as ",a,b,c," in one hash field.
// Plain (non-pattern) string.find is used, because channels can contain Lua pattern magic characters.

const channelAdd = `
local key = KEYS[1]
local field = ARGV[1]

local str = redis.call('HGET', key, field)
if not str then
  return 0
end

local added = 0
for i = 2, #ARGV do
  if not string.find(str, ','..ARGV[i]..',', 1, true) then
    str = str..ARGV[i]..','
    added = added + 1
  end
end

if added > 0 then
  redis.call('HSET', key, field, str)
end

return added
`

const channelRemove = `
local key = KEYS[1]
local field = ARGV[1]

local str = redis.call('HGET', key, field)
if not str then
  return 0
end

local removed = 0
for i = 2, #ARGV do
  local from, to = string.find(str, ','..ARGV[i]..',', 1, true)
  if from then
    str = string.sub(str, 1, from)..string.sub(str, to + 1)
    removed = removed + 1
  end
end

if removed > 0 then
  redis.call('HSET', key, field, str)
end

return removed
`

const hsetWithTTL = `
local key = KEYS[1]
redis.call('HSET', key, unpack(ARGV, 2))
redis.call('EXPIRE', key, ARGV[1])
`

const incWithReset = `
local id = redis.call('INCR', KEYS[1])
if id > ${ID_MAX} then
  redis.call('SET', KEYS[1], 1)
  return 1
end
return id
`

export const unlock = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end
`

export const SCRIPTS = {
  channelAdd: { lua: channelAdd, numberOfKeys: 1 },
  channelRemove: { lua: channelRemove, numberOfKeys: 1 },
  hsetWithTTL: { lua: hsetWithTTL, numberOfKeys: 1 },
  incWithReset: { lua: incWithReset, numberOfKeys: 1 },
}
