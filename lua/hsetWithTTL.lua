local key = KEYS[1]
redis.call('HSET', key, unpack(ARGV, 2))
redis.call('EXPIRE', key, ARGV[1])