---
layout: default
title: MQTT Functions
nav_order: 10
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

## UNS Plugin

FnKit includes a built-in plugin for [Unified Namespace (UNS)](https://www.unsframework.com) workflows — industrial IoT data flowing through hierarchical MQTT topics following ISA-95.

The `fnkit mqtt` commands scaffold and manage three pre-built UNS functions: a topic monitor, a cache reader, and a PostgreSQL logger.

→ **[Full UNS Plugin documentation](uns-plugin.md)**

---

← [Back to README](../README.md) · [UNS Plugin →](uns-plugin.md) · [Runtimes →](runtimes.md) · [Cache →](cache.md)
