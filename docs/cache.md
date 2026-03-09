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

| Setting         | Default       | Description                                |
| --------------- | ------------- | ------------------------------------------ |
| Max memory      | 256 MB        | Configurable via `--maxmemory` flag        |
| Eviction policy | allkeys-lru   | Least recently used keys evicted when full |
| Persistence     | RDB snapshots | Saves to disk every 60s if ≥1 key changed  |
| Port            | 6379          | Standard Redis port                        |

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

## Observing the Cache

Browse and inspect cache contents directly from the CLI.

### View All Keys

```bash
# List all keys grouped by namespace
fnkit cache view

# Filter by pattern
fnkit cache view "uns:*"
fnkit cache view "fnkit:config:*"
```

Output groups keys by namespace prefix (`fnkit:config`, `uns:data`, `fnkit:events`, etc.) with type annotations for non-string keys.

### Get a Key Value

```bash
# View any key — auto-detects type (string, list, set, hash, zset)
fnkit cache get fnkit:config:uns-log
fnkit cache get uns:topics
fnkit cache get fnkit:events
```

For strings, JSON values are pretty-printed. Lists show indexed items, sets show members, hashes show field/value pairs, and sorted sets show members with scores.

### Cache Statistics

```bash
fnkit cache stats
```

Shows:
- **General** — key count, uptime, version, connected clients
- **Memory** — used, peak, max, eviction policy, fragmentation ratio
- **Performance** — commands processed, connections, hit/miss ratio, evicted/expired keys
- **Key Namespaces** — breakdown of keys by prefix with counts

## Managing Function Configs

Functions like `uns-log` store their configuration in Valkey under `fnkit:config:*` keys. The `cache config` commands provide a convenient way to manage these.

### List All Configs

```bash
fnkit cache config
# or
fnkit cache config ls
```

### View a Config

```bash
fnkit cache config get uns-log
```

### Set a Config

```bash
fnkit cache config set uns-log '{"table":"uns_log","topics":["v1.0/acme/factory1/mixing/line1/temperature"]}'
```

Values must be valid JSON. The config is stored at `fnkit:config:<name>` in Valkey.

### Remove a Config

```bash
fnkit cache config remove uns-log
```

## Admin Operations

### Remove a Key

```bash
fnkit cache remove mykey
fnkit cache remove fnkit:config:old-function
```

### Flush All Data

```bash
fnkit cache flush
```

⚠️ This deletes **all** keys from the cache — configs, UNS data, events, traces, everything.

## Key Namespaces

The cache stores data from multiple fnkit components:

| Namespace           | Used by          | Description                              |
| ------------------- | ---------------- | ---------------------------------------- |
| `fnkit:config:*`    | uns-log, etc.    | Function configuration (JSON)            |
| `uns:topics`        | uns-framework    | SET of all discovered MQTT topic paths   |
| `uns:data:<topic>`  | uns-framework    | Latest payload for a topic               |
| `uns:prev:<topic>`  | uns-framework    | Previous payload for a topic             |
| `uns:meta:<topic>`  | uns-framework    | Metadata (last_updated, count, etc.)     |
| `fnkit:events`      | gateway          | LIST of event JSON objects               |
| `fnkit:traces`      | gateway          | LIST of request trace JSON objects       |
| `fnkit:metrics:*`   | gateway          | Per-container metrics (JSON)             |
| `fnkit:pipeline:*`  | gateway          | Orchestrator pipeline definitions        |

## Command Reference

```
fnkit cache <command> [options]

Lifecycle:
  init                          Create cache project files
  start                         Start the cache container
  stop                          Stop the cache container

Observe:
  view [pattern]                List all keys (grouped by namespace)
  get <key>                     Show value of a specific key
  stats                         Show cache statistics

Config:
  config                        List all function configs
  config ls                     List all function configs
  config get <name>             View a specific function config
  config set <name> <json>      Set a function config
  config remove <name>          Remove a function config

Admin:
  remove <key>                  Delete a specific key
  flush                         Delete ALL keys from the cache

Options:
  --maxmemory <size>            Max memory for start (default: 256mb)
```

## Why Valkey?

Valkey is the community fork of Redis, maintained by the Linux Foundation with backing from AWS, Google, Oracle, and others. It's wire-protocol compatible with Redis — every Redis client library works unchanged. Fully open source under the BSD license.

## Notes

- Cache data persists in the `fnkit-cache-data` Docker volume (survives restarts)
- All function containers on `fnkit-network` can access the cache
- No authentication by default (internal network only)
- The cache container is labelled `fnkit.cache=true` for easy identification

---

← [Back to README](../README.md) · [Gateway →](gateway.md) · [Proxy →](proxy.md)
