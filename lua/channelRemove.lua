local key = KEYS[1]
local chnl_key = ARGV[1]
local chnl_arg = ARGV[2]

local chnl_str = redis.call('HGET', key, chnl_key)

local chnl = {}
local removed = false
for match in chnl_str:gmatch('([^,]+)') do
  if match ~= chnl_arg then
    table.insert(chnl, match)
  else
    removed = true
  end
end

if removed then
  redis.call('HSET', key, chnl_key, table.concat(chnl, ','))
  return 1
end

return 0
