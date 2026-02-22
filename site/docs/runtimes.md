---
layout: default
title: Runtimes
nav_order: 4
---

# Supported Runtimes

FnKit supports 9 HTTP runtimes via the [Google Cloud Functions Framework](https://github.com/GoogleCloudPlatform/functions-framework) and 3 MQTT runtimes via the [FnKit Function Framework](https://github.com/functionkit).

## HTTP Runtimes

HTTP functions listen on port 8080 and handle standard HTTP requests. They're compatible with the Google Cloud Functions Framework, so you can use the same function signature locally and in production.

| Runtime | Command | Framework | Quickstart |
|:--------|:--------|:----------|:-----------|
| Node.js | `fnkit node <name>` | [functions-framework-nodejs](https://github.com/GoogleCloudPlatform/functions-framework-nodejs) | [Guide](https://github.com/GoogleCloudPlatform/functions-framework-nodejs#quickstart) |
| Python | `fnkit python <name>` | [functions-framework-python](https://github.com/GoogleCloudPlatform/functions-framework-python) | [Guide](https://github.com/GoogleCloudPlatform/functions-framework-python#quickstart) |
| Go | `fnkit go <name>` | [functions-framework-go](https://github.com/GoogleCloudPlatform/functions-framework-go) | [Guide](https://github.com/GoogleCloudPlatform/functions-framework-go#quickstart) |
| Java | `fnkit java <name>` | [functions-framework-java](https://github.com/GoogleCloudPlatform/functions-framework-java) | [Guide](https://github.com/GoogleCloudPlatform/functions-framework-java#quickstart) |
| Ruby | `fnkit ruby <name>` | [functions-framework-ruby](https://github.com/GoogleCloudPlatform/functions-framework-ruby) | [Guide](https://github.com/GoogleCloudPlatform/functions-framework-ruby#quickstart) |
| .NET | `fnkit dotnet <name>` | [functions-framework-dotnet](https://github.com/GoogleCloudPlatform/functions-framework-dotnet) | [Guide](https://github.com/GoogleCloudPlatform/functions-framework-dotnet#quickstart) |
| PHP | `fnkit php <name>` | [functions-framework-php](https://github.com/GoogleCloudPlatform/functions-framework-php) | [Guide](https://github.com/GoogleCloudPlatform/functions-framework-php#quickstart) |
| Dart | `fnkit dart <name>` | [functions-framework-dart](https://github.com/GoogleCloudPlatform/functions-framework-dart) | [Guide](https://github.com/GoogleCloudPlatform/functions-framework-dart#quickstart) |
| C++ | `fnkit cpp <name>` | [functions-framework-cpp](https://github.com/GoogleCloudPlatform/functions-framework-cpp) | [Guide](https://github.com/GoogleCloudPlatform/functions-framework-cpp#quickstart) |

### Creating an HTTP Function

```bash
# Shorthand (recommended)
fnkit node my-api

# Explicit form
fnkit new python my-api

# With a git remote
fnkit go my-api --remote git@github.com:user/my-api.git
```

### What Gets Generated

Each runtime generates a project with:

- **Source file** — A hello world function using the framework's standard signature
- **Dockerfile** — Multi-stage build optimised for the runtime
- **docker-compose.yml** — Pre-configured for `fnkit-network` and gateway integration
- **.gitignore** — Tailored to the runtime
- **Dependencies** — Installed automatically (e.g., `npm install`, `pip install`)

### Running Locally

```bash
cd my-api
fnkit dev                       # Uses the runtime's dev command
fnkit dev --port 3000           # Custom port
fnkit dev --target myFunction   # Specific function target
```

## MQTT Runtimes

MQTT functions subscribe to topics on an MQTT broker instead of listening on HTTP. They're event-driven — each message triggers your function handler.

| Runtime | Command | Framework |
|:--------|:--------|:----------|
| Node.js | `fnkit node-mqtt <name>` | [function-framework-nodejs](https://github.com/functionkit/function-framework-nodejs) |
| Go | `fnkit go-mqtt <name>` | [function-framework-go](https://github.com/functionkit/function-framework-go) |
| .NET | `fnkit dotnet-mqtt <name>` | [function-framework-dotnet](https://github.com/functionkit/function-framework-dotnet) |

### Creating an MQTT Function

```bash
fnkit node-mqtt my-handler
fnkit go-mqtt my-handler
fnkit dotnet-mqtt my-handler
```

MQTT functions connect to a broker and subscribe to `{prefix}/{target}` (e.g., `fnkit/my-handler`). See the [MQTT deep dive]({% link docs/mqtt.md %}) for configuration, environment variables, and broker setup.

## Checking Runtime Dependencies

```bash
# Check all runtimes
fnkit doctor

# Check a specific runtime
fnkit doctor node
fnkit doctor python
fnkit doctor go
```

The doctor command checks that the runtime and any required build tools (e.g., Maven for Java, CMake for C++) are installed and available in your PATH.
