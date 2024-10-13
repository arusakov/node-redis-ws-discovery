local key = KEYS[1]
local id = redis.call('INCR', key)
if id >= 1073741824 then
  redis.call('SET', key, 0)
end
return id