local key = KEYS[1]
local chnl_key = ARGV[1]
local chnl_arg = ARGV[2]

local chnl_str = redis.call('HGET', key, chnl_key)
local index = string.find(chnl_str, ','..chnl_arg..',')

if index then
  return 0
end

redis.call('HSET', key, chnl_key, chnl_str..chnl_arg..',')

return 1