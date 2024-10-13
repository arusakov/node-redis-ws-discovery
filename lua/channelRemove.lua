local key = KEYS[1]
local chnl_key = ARGV[1]

local chnl_str = redis.call('HGET', key, chnl_key)
local chnl, cnt = string.gsub(chnl_str, ','..ARGV[2]..',', ',')

if cnt > 0 then
  redis.call('HSET', key, chnl_key, chnl)
  return 1
end

return 0
