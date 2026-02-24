---
layout: default
title: MQTT Functions
nav_order: 13
---

# MQTT Functions

FnKit supports event-driven functions that subscribe to MQTT topics instead of listening on HTTP. Each function connects to an MQTT broker, subscribes to a topic, and processes messages as they arrive.

## How It Works

```
MQTT Broker (e.g. Mosquitto)
  │
  ├── topic: fnkit/my-handler  →  my-handler container (processes message)
  ├── topic: fnkit/sensor-data →  sensor-data container (processes message)
  └── topic: fnkit/alerts      →  alerts container (processes message)
```

Unlike HTTP functions which listen on a port, MQTT functions are **subscribers** — they connect to a broker and wait for messages on their topic. The topic is `{prefix}/{target}` by default (e.g. `fnkit/my-handler`).

## Supported Runtimes

| Runtime | Command                    | Framework                                                                             |
| ------- | -------------------------- | ------------------------------------------------------------------------------------- |
| Node.js | `fnkit node-mqtt <name>`   | [function-framework-nodejs](https://github.com/functionkit/function-framework-nodejs) |
| Go      | `fnkit go-mqtt <name>`     | [function-framework-go](https://github.com/functionkit/function-framework-go)         |
| .NET    | `fnkit dotnet-mqtt <name>` | [function-framework-dotnet](https://github.com/functionkit/function-framework-dotnet) |

These use the **FnKit Function Framework** (not the Google Cloud Functions Framework used by HTTP runtimes).

## Quick Start

```bash
# Create an MQTT function
fnkit node-mqtt my-handler
cd my-handler

# Edit the handler function
# Then build and run
docker compose up -d
```

## Environment Variables

MQTT functions are configured entirely via environment variables, set in the generated `docker-compose.yml` and `Dockerfile`.

### Connection

| Variable          | Description                                 | Default                 |
| ----------------- | ------------------------------------------- | ----------------------- |
| `MQTT_BROKER`     | Broker connection URL                       | `mqtt://localhost:1883` |
| `FUNCTION_TARGET` | Function name to invoke                     | —                       |
| `MQTT_CLIENT_ID`  | Client identifier (auto-generated if empty) | —                       |

### Topics

| Variable               | Description                                                    | Default |
| ---------------------- | -------------------------------------------------------------- | ------- |
| `MQTT_TOPIC_PREFIX`    | Topic prefix — subscribes to `{prefix}/{target}`               | `fnkit` |
| `MQTT_SUBSCRIBE_TOPIC` | Override the full subscribe topic (e.g. `v1.0/#` for wildcard) | —       |
| `MQTT_QOS`             | QoS level (0, 1, or 2)                                         | `1`     |

### Authentication

| Variable        | Description                    | Default |
| --------------- | ------------------------------ | ------- |
| `MQTT_USERNAME` | Broker authentication username | —       |
| `MQTT_PASSWORD` | Broker authentication password | —       |

### TLS / mTLS

| Variable                   | Description                          | Default |
| -------------------------- | ------------------------------------ | ------- |
| `MQTT_CA`                  | Path to CA certificate               | —       |
| `MQTT_CERT`                | Path to client certificate (mTLS)    | —       |
| `MQTT_KEY`                 | Path to client key (mTLS)            | —       |
| `MQTT_REJECT_UNAUTHORIZED` | Reject unauthorized TLS certificates | `true`  |

## Docker Compose

The generated `docker-compose.yml` includes all environment variables and an optional Mosquitto broker:

```yaml
services:
  my-handler:
    build: .
    container_name: my-handler
    environment:
      - MQTT_BROKER=mqtt://mosquitto:1883
      - FUNCTION_TARGET=helloWorld
      - MQTT_TOPIC_PREFIX=fnkit
      - MQTT_QOS=1
    networks:
      - fnkit-network
    depends_on:
      mosquitto:
        condition: service_started

  # Uncomment to include a broker
  # mosquitto:
  #   image: eclipse-mosquitto:2
  #   container_name: mosquitto
  #   ports:
  #     - "1883:1883"
  #   networks:
  #     - fnkit-network

networks:
  fnkit-network:
    name: fnkit-network
    external: true
```

## Running a Broker

MQTT functions need a broker to connect to. You can use any MQTT broker — here are common options:

### Mosquitto (lightweight, local)

```bash
docker run -d \
  --name mosquitto \
  --network fnkit-network \
  -p 1883:1883 \
  eclipse-mosquitto:2
```

### EMQX (production-grade)

```bash
docker run -d \
  --name emqx \
  --network fnkit-network \
  -p 1883:1883 \
  -p 18083:18083 \
  emqx/emqx:5
```

### Cloud Brokers

You can also use cloud MQTT services — just set `MQTT_BROKER` to the cloud endpoint:

```env
MQTT_BROKER=mqtts://broker.hivemq.cloud:8883
MQTT_USERNAME=your-username
MQTT_PASSWORD=your-password
```

## Testing

### Publish a Test Message

With Mosquitto CLI tools:

```bash
# Install mosquitto-clients
apt install mosquitto-clients  # or brew install mosquitto

# Publish to your function's topic
mosquitto_pub -h localhost -t "fnkit/my-handler" -m '{"hello": "world"}'
```

### With Docker

```bash
docker exec mosquitto mosquitto_pub -t "fnkit/my-handler" -m '{"hello": "world"}'
```

## Topic Patterns

### Default

By default, functions subscribe to `{MQTT_TOPIC_PREFIX}/{FUNCTION_TARGET}`:

```
MQTT_TOPIC_PREFIX=fnkit + FUNCTION_TARGET=my-handler → fnkit/my-handler
```

### Custom Topic

Override with `MQTT_SUBSCRIBE_TOPIC` for custom patterns:

```env
# Subscribe to a specific topic
MQTT_SUBSCRIBE_TOPIC=sensors/temperature/room1

# Wildcard — all messages under a prefix
MQTT_SUBSCRIBE_TOPIC=sensors/#

# Single-level wildcard
MQTT_SUBSCRIBE_TOPIC=sensors/+/room1
```

## Publishing from a Function

MQTT functions subscribe to topics by default, but you can also **publish** to other topics from within your handler. This is useful for processing pipelines — e.g. subscribe to `sensors/raw`, transform the data, and publish to `sensors/processed`.

Each runtime uses a standard MQTT client library to create a publish connection alongside the framework's subscribe connection.

### Node.js

```bash
npm install mqtt
```

```js
const fnkit = require('@functionkit/functions-framework');
const mqtt = require('mqtt');

const pub = mqtt.connect(process.env.MQTT_BROKER || 'mqtt://localhost:1883');

fnkit.mqtt('processRaw', (req, res) => {
  const processed = { temperature: req.body.raw * 0.1 };
  pub.publish('sensors/processed', JSON.stringify(processed));
  res.send({ status: 'published' });
});
```

### Go

```bash
go get github.com/eclipse/paho.mqtt.golang
```

```go
import (
    "encoding/json"
    "os"
    mqtt "github.com/eclipse/paho.mqtt.golang"
    "github.com/functionkit/function-framework-go/functions"
)

var pub mqtt.Client

func init() {
    opts := mqtt.NewClientOptions().AddBroker(os.Getenv("MQTT_BROKER"))
    pub = mqtt.NewClient(opts)
    if token := pub.Connect(); token.Wait() && token.Error() != nil {
        log.Fatalf("publish client: %v", token.Error())
    }
    functions.MQTT("processRaw", processRaw)
}

func processRaw(req *functions.MqttRequest, res functions.MqttResponse) {
    payload, _ := json.Marshal(map[string]float64{"temperature": 22.5})
    pub.Publish("sensors/processed", 1, false, payload)
    res.Send(map[string]string{"status": "published"})
}
```

### .NET

```bash
dotnet add package MQTTnet
```

```csharp
using MQTTnet;
using MQTTnet.Client;

public class Publisher
{
    private static readonly Lazy<Task<IMqttClient>> _client = new(CreateClientAsync);

    private static async Task<IMqttClient> CreateClientAsync()
    {
        var factory = new MqttFactory();
        var client = factory.CreateMqttClient();
        var broker = Environment.GetEnvironmentVariable("MQTT_BROKER") ?? "mqtt://localhost:1883";
        var uri = new Uri(broker);
        var options = new MqttClientOptionsBuilder()
            .WithTcpServer(uri.Host, uri.Port)
            .Build();
        await client.ConnectAsync(options);
        return client;
    }

    public static async Task PublishAsync(string topic, object payload)
    {
        var client = await _client.Value;
        var json = System.Text.Json.JsonSerializer.Serialize(payload);
        var message = new MqttApplicationMessageBuilder()
            .WithTopic(topic)
            .WithPayload(json)
            .WithQualityOfServiceLevel(MQTTnet.Protocol.MqttQualityOfServiceLevel.AtLeastOnce)
            .Build();
        await client.PublishAsync(message);
    }
}

// Usage inside your function:
await Publisher.PublishAsync("sensors/processed", new { temperature = 22.5 });
```

### Notes

- The publish client reuses the same `MQTT_BROKER` environment variable as the subscriber
- Broker authentication (`MQTT_USERNAME`, `MQTT_PASSWORD`) and TLS settings apply to publish connections too — configure them on your client as needed
- For high-throughput publishing, create the client once (as shown above) rather than per-message

## QoS Levels

| Level | Name          | Guarantee                                         |
| ----- | ------------- | ------------------------------------------------- |
| 0     | At most once  | Fire and forget — message may be lost             |
| 1     | At least once | Message delivered at least once (may duplicate)   |
| 2     | Exactly once  | Message delivered exactly once (highest overhead) |

Default is QoS 1 (at least once), which is suitable for most use cases.

## MQTT vs HTTP Functions

|               | HTTP Functions               | MQTT Functions                 |
| ------------- | ---------------------------- | ------------------------------ |
| **Trigger**   | HTTP request                 | MQTT message                   |
| **Protocol**  | HTTP/1.1                     | MQTT 3.1.1 / 5.0               |
| **Pattern**   | Request/response             | Pub/sub                        |
| **Gateway**   | Routed via fnkit-gateway     | Direct broker connection       |
| **Use cases** | APIs, webhooks, web services | IoT, sensors, event processing |
| **Runtimes**  | 9 (all languages)            | 3 (Node.js, Go, .NET)          |

## Notes

- MQTT functions don't use the API gateway — they connect directly to the broker
- Each function gets its own container and MQTT connection
- Functions can also use the [shared cache](cache.md) via `CACHE_URL`
- The `CACHE_URL=redis://fnkit-cache:6379` environment variable is set in generated Dockerfiles

## OPC-UA Bridge (`fnkit uns opcua`)

FnKit includes a built-in OPC-UA → MQTT bridge that connects to OPC-UA servers, reads tags, and publishes data to MQTT topics. Written in Go, it compiles to a single static binary — run it as a Docker container on a server or as a standalone `.exe` on edge devices.

```
OPC-UA Server (opc.tcp://...)
    │
    │  Read (poll) / Subscribe (real-time)
    │
    ▼
┌──────────────────────────────────────┐
│  opcua-bridge (Go binary)            │
│                                      │
│  Tag Groups:                         │
│  ├── machine-data (subscribe)        │
│  │   → legacy/mill8                  │
│  ├── condition-monitoring (poll 60s) │
│  │   → condition_legacy/mill8        │
│  └── motor-torque-power (poll 10s)   │
│      → motor_legacy/mill8            │
│                                      │
│  Status → connection/mill8           │
└──────────────────────────────────────┘
    │
    │  MQTT Publish (JSON)
    │
    ▼
MQTT Broker → uns-framework → fnkit-cache → uns-log
```

### Commands

| Command | Description |
|---|---|
| `fnkit uns opcua init [name]` | Scaffold OPC-UA bridge project (default: `opcua-bridge/`) |
| `fnkit uns opcua start [name]` | Build & start bridge container |
| `fnkit uns opcua stop [name]` | Stop bridge container |
| `fnkit uns opcua build [name]` | Cross-compile standalone binaries to `dist/` |

### Quick Start

```bash
# Create the bridge project
fnkit uns opcua init
cd opcua-bridge

# Edit tag configuration
vi tags.yaml

# Option A: Run as Docker container
cp .env.example .env
docker compose up -d

# Option B: Build standalone binaries for edge deployment
fnkit uns opcua build
# → dist/opcua-bridge-windows-amd64.exe
# → dist/opcua-bridge-linux-amd64
# → dist/opcua-bridge-linux-arm64
# → dist/opcua-bridge-darwin-arm64
```

### Tag Configuration (`tags.yaml`)

Tags are organised into groups, each with its own MQTT topic and read mode:

```yaml
opcua:
  endpoint: "opc.tcp://192.168.1.100:4840/"
  security_policy: "Basic256Sha256"     # None | Basic256Sha256 | Basic256
  security_mode: "SignAndEncrypt"        # None | Sign | SignAndEncrypt
  username: ""
  password: ""
  insecure: false

mqtt:
  broker: "mqtt://localhost:1883"
  client_id: "my-bridge"
  qos: 1

status_topic: "connection/my-bridge"

groups:
  - name: "machine-data"
    topic: "legacy/mill8"
    mode: "subscribe"                   # Real-time OPC-UA subscription
    interval: 1000
    tags:
      - name: "Spindle Speed"
        node_id: "ns=2;s=/Channel/Spindle/cmdSpeed"
      - name: "Feed Rate"
        node_id: "ns=2;s=/Channel/State/cmdFeedRateIpo"

  - name: "condition-monitoring"
    topic: "condition_legacy/mill8"
    mode: "poll"                        # Read on interval
    interval: 60000                     # 60 seconds
    tags:
      - name: "X Motor Temp"
        node_id: "ns=2;s=/DriveVsa/Drive/R0035[u3]"
```

### Tag Group Modes

| Mode | Description |
|---|---|
| `poll` | Read all tags on a fixed interval (e.g. every 10s, 60s). Good for slow-changing data like temperatures. |
| `subscribe` | OPC-UA subscription — the server pushes changes in real-time. Good for fast-changing data like spindle speed. |

### OPC-UA Security

| Security Policy | Security Mode | Use Case |
|---|---|---|
| `None` | `None` | Development / testing |
| `Basic256Sha256` | `Sign` | Signed messages |
| `Basic256Sha256` | `SignAndEncrypt` | Full encryption (production) |

For certificate-based auth, place certs in `certs/` and set paths in `tags.yaml`:

```yaml
opcua:
  certificate: "/certs/opcua-client.crt"
  private_key: "/certs/opcua-client.key"
```

### MQTT Security

Supports plain, TLS, mTLS, and username/password:

```yaml
mqtt:
  broker: "mqtts://broker:8883"        # TLS
  ca: "/certs/mqtt-ca.crt"
  cert: "/certs/mqtt-client.crt"       # mTLS
  key: "/certs/mqtt-client.key"
  insecure: false                       # Set true for self-signed certs
```

### Environment Variable Overrides

All connection settings in `tags.yaml` can be overridden via environment variables (useful for Docker/CI):

| Variable | Description |
|---|---|
| `OPCUA_ENDPOINT` | OPC-UA server endpoint |
| `OPCUA_SECURITY_POLICY` | None / Basic256Sha256 / Basic256 |
| `OPCUA_SECURITY_MODE` | None / Sign / SignAndEncrypt |
| `OPCUA_USERNAME` / `OPCUA_PASSWORD` | OPC-UA authentication |
| `OPCUA_INSECURE` | Skip OPC-UA cert validation |
| `MQTT_BROKER` | MQTT broker URL |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | MQTT authentication |
| `MQTT_INSECURE` | Skip MQTT TLS validation |
| `STATUS_TOPIC` | Connection status MQTT topic |

### Edge Deployment

The `build` command cross-compiles standalone binaries via Docker:

```bash
fnkit uns opcua build

# Copy to edge machine:
#   opcua-bridge-windows-amd64.exe
#   tags.yaml
#   certs/  (if using TLS)
#
# Run on the edge machine:
./opcua-bridge-windows-amd64.exe
```

No Docker, no runtime dependencies — just the binary, config file, and optional certs.

### Built With

- [gopcua/opcua](https://github.com/gopcua/opcua) — OPC-UA client library for Go
- [eclipse/paho.mqtt.golang](https://github.com/eclipse/paho.mqtt.golang) — MQTT client
- [gopkg.in/yaml.v3](https://gopkg.in/yaml.v3) — YAML configuration

## UNS Plugin (`fnkit uns`)

FnKit includes a built-in plugin for [Unified Namespace (UNS)](https://www.unsframework.com) workflows — a common industrial IoT pattern where all enterprise data flows through a hierarchical MQTT topic structure following ISA-95.

The plugin provides three pre-built functions that work together:

```
MQTT Broker (v1.0/#)
    │
    ▼
uns-framework (Go MQTT function)
    │  Subscribes to v1.0/#
    │  Caches every message to Valkey
    ▼
fnkit-cache (Valkey)
    │
    ├── uns-cache (Node.js HTTP function)
    │   Reads cached topics, returns JSON with change detection
    │
    └── uns-log (Go HTTP function)
        Logs changed values to PostgreSQL
```

### Commands

| Command | Description |
|---|---|
| `fnkit uns uns init [name]` | Scaffold UNS topic monitor (Go MQTT → Valkey) |
| `fnkit uns uns start [name]` | Build & start monitor container |
| `fnkit uns uns stop [name]` | Stop monitor container |
| `fnkit uns cache init [name]` | Scaffold UNS cache reader (Node.js HTTP → JSON) |
| `fnkit uns cache start [name]` | Build & start cache reader |
| `fnkit uns cache stop [name]` | Stop cache reader |
| `fnkit uns log init [name]` | Scaffold PostgreSQL logger (Go HTTP → Postgres) |
| `fnkit uns log start [name]` | Build & start logger |
| `fnkit uns log stop [name]` | Stop logger |
| `fnkit uns status` | Show status of all UNS components |

### Quick Start

```bash
# 1. Start the shared cache
fnkit cache start

# 2. Create and configure the UNS monitor
fnkit uns uns init
cd uns-framework
cp .env.example .env
# Edit .env: set MQTT_BROKER, auth, TLS certs as needed
docker compose up -d

# 3. Create the cache reader (HTTP API for cached data)
cd ..
fnkit uns cache init
cd uns-cache
cp .env.example .env
docker compose up -d

# 4. (Optional) Create the PostgreSQL logger
cd ..
fnkit uns log init
cd uns-log
cp .env.example .env
# Set config in Valkey:
docker exec fnkit-cache valkey-cli SET fnkit:config:uns-log \
  '{"table":"uns_log","topics":["v1.0/enterprise/site/area/line/temperature"]}'
docker compose up -d
```

### TLS / mTLS Support

The UNS monitor (`fnkit uns uns init`) includes full TLS/mTLS support:

1. Place certificates in the `certs/` directory
2. Configure paths in `.env`:

```env
# TLS (server verification)
MQTT_BROKER=mqtts://broker:8883
MQTT_CA=/certs/ca.crt

# mTLS (mutual authentication)
MQTT_CERT=/certs/client.crt
MQTT_KEY=/certs/client.key

# Self-signed certificates
MQTT_REJECT_UNAUTHORIZED=false
```

The `docker-compose.yml` mounts `./certs:/certs:ro` automatically.

### Cache Key Layout

The UNS monitor writes to Valkey with this key structure:

| Key Pattern | Type | Description |
|---|---|---|
| `uns:topics` | SET | All discovered topic paths |
| `uns:data:<topic>` | STRING | Latest payload (raw JSON) |
| `uns:prev:<topic>` | STRING | Previous payload (raw JSON) |
| `uns:meta:<topic>` | STRING | `{"last_updated", "count", "first_seen"}` |

Query from CLI:
```bash
docker exec fnkit-cache valkey-cli SMEMBERS uns:topics
docker exec fnkit-cache valkey-cli GET "uns:data:v1.0/enterprise/site/area/line/temperature"
```

---

← [Back to README](../README.md) · [Runtimes →](runtimes.md) · [Cache →](cache.md)
