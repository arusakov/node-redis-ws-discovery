local key = KEYS[1]
local chnl_key = ARGV[1]
local chnl_arg = ARGV[2]

local chnl_str = redis.call('HGET', key, chnl_key)
for match in chnl_str:gmatch('([^,]+)') do
  if chnl_arg == match then
    return 0
  end
end

if chnl_str == '' then
  chnl_str = chnl_arg
else
  chnl_str = chnl_str .. ',' .. chnl_arg
end

redis.call('HSET', key, chnl_key, chnl_str)

return 1