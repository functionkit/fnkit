---
layout: default
title: Shared Cache
nav_order: 8
---

# Shared Cache

FnKit includes a shared cache powered by [Valkey](https://valkey.io/) — a Redis-compatible, open-source key-value store maintained by the Linux Foundation. All function containers on `fnkit-network` can access it with sub-millisecond latency.

## Architecture

```
Function containers ──→ fnkit-cache:6379 (Valkey)
                         ├── Sub-millisecond reads/writes
                         ├── TTL support (auto-expire keys)
                         ├── Persistent (snapshots to disk)
                         └── 256 MB max memory (LRU eviction)
```

## Quick Start

```bash
# Create cache project files
fnkit cache init

# Start the cache
fnkit cache start

# Verify it's running
docker exec fnkit-cache valkey-cli ping
# → PONG
```

All function containers on `fnkit-network` can now connect at:

```
redis://fnkit-cache:6379
```

The `CACHE_URL` environment variable is automatically set in generated Dockerfiles.

## Configuration

| Setting | Default | Description |
|:--------|:--------|:------------|
| Max memory | 256 MB | Configurable via `--maxmemory` flag |
| Eviction policy | allkeys-lru | Least recently used keys evicted when full |
| Persistence | RDB snapshots | Saves to disk every 60s if ≥1 key changed |
| Port | 6379 | Standard Redis port |

### Custom Memory Limit

```bash
fnkit cache start --maxmemory 512mb
```

## Connecting from Functions

Every generated function template includes a commented-out cache example. Uncomment it and install the client library for your language.

### Node.js

```bash
npm install ioredis
```

```js
const Redis = require('ioredis')
const cache = new Redis(process.env.CACHE_URL || 'redis://fnkit-cache:6379')

await cache.set('key', 'value', 'EX', 300) // expires in 5 minutes
const value = await cache.get('key')
```

### Python

```bash
pip install redis
```

```python
import os, redis
cache = redis.from_url(os.environ.get('CACHE_URL', 'redis://fnkit-cache:6379'))

cache.set('key', 'value', ex=300)
value = cache.get('key')
```

### Go

```bash
go get github.com/redis/go-redis/v9
```

```go
import "github.com/redis/go-redis/v9"

rdb := redis.NewClient(&redis.Options{Addr: "fnkit-cache:6379"})
rdb.Set(ctx, "key", "value", 5*time.Minute)
value, _ := rdb.Get(ctx, "key").Result()
```

### Java

Add `jedis` to your `pom.xml`:

```java
import redis.clients.jedis.Jedis;

Jedis cache = new Jedis("fnkit-cache", 6379);
cache.setex("key", 300, "value");
String value = cache.get("key");
```

### Ruby

```bash
gem install redis
```

```ruby
require 'redis'
cache = Redis.new(url: ENV.fetch('CACHE_URL', 'redis://fnkit-cache:6379'))

cache.set('key', 'value', ex: 300)
value = cache.get('key')
```

### .NET

```bash
dotnet add package StackExchange.Redis
```

```csharp
using StackExchange.Redis;

var redis = ConnectionMultiplexer.Connect("fnkit-cache:6379");
var db = redis.GetDatabase();
db.StringSet("key", "value", TimeSpan.FromMinutes(5));
var value = db.StringGet("key");
```

### PHP

```bash
composer require predis/predis
```

```php
require 'vendor/autoload.php';
$cache = new Predis\Client(getenv('CACHE_URL') ?: 'redis://fnkit-cache:6379');

$cache->setex('key', 300, 'value');
$value = $cache->get('key');
```

## Managing the Cache

```bash
# Stop the cache (data persists in Docker volume)
fnkit cache stop

# Test with CLI
docker exec fnkit-cache valkey-cli SET hello world
docker exec fnkit-cache valkey-cli GET hello

# Monitor stats
docker exec fnkit-cache valkey-cli INFO stats

# Flush all data
docker exec fnkit-cache valkey-cli FLUSHALL

# Remove persisted data
docker volume rm fnkit-cache-data
```

## Why Valkey?

Valkey is the community fork of Redis, maintained by the Linux Foundation with backing from AWS, Google, Oracle, and others. It's wire-protocol compatible with Redis — every Redis client library works unchanged. Fully open source under the BSD license.

## Notes

- Cache data persists in the `fnkit-cache-data` Docker volume (survives restarts)
- All function containers on `fnkit-network` can access the cache
- No authentication by default (internal network only)
- The cache container is labelled `fnkit.cache=true` for easy identification
