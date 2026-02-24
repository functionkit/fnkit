// Go MQTT runtime
// https://github.com/functionkit/function-framework-go

import { createRuntime } from './base'

export const goMqtt = createRuntime({
  name: 'go-mqtt',
  displayName: 'Go (MQTT)',
  repo: 'https://github.com/functionkit/function-framework-go',
  quickstartUrl: 'https://github.com/functionkit/function-framework-go#readme',
  checkCommand: 'go',
  checkArgs: ['version'],
  installHint: 'Install Go from https://go.dev or use: brew install go',
  filePatterns: ['go.mod', 'go.sum'],
  runCommand: ['go', 'run', './cmd/main.go'],
  dockerfile: `FROM golang:1.21 AS builder
LABEL fnkit.fn="true"
WORKDIR /app
COPY . .
RUN go mod tidy && CGO_ENABLED=0 GOOS=linux go build -o server ./cmd/main.go

FROM gcr.io/distroless/static-debian11
COPY --from=builder /app/server /server

# MQTT broker connection
ENV MQTT_BROKER=mqtt://localhost:1883
# Function target name
ENV FUNCTION_TARGET=helloWorld
# Topic prefix (subscribes to {prefix}/{target})
ENV MQTT_TOPIC_PREFIX=fnkit
# MQTT QoS level (0, 1, or 2)
ENV MQTT_QOS=1
# MQTT client identifier (auto-generated if empty)
ENV MQTT_CLIENT_ID=
# MQTT broker authentication
ENV MQTT_USERNAME=
ENV MQTT_PASSWORD=
# TLS: path to CA certificate
ENV MQTT_CA=
# mTLS: path to client certificate and key
ENV MQTT_CERT=
ENV MQTT_KEY=
# Whether to reject unauthorized TLS certificates
ENV MQTT_REJECT_UNAUTHORIZED=true
# Override subscribe topic (e.g. "v1.0/#" for wildcard). If empty, uses {prefix}/{target}
ENV MQTT_SUBSCRIBE_TOPIC=
# Shared cache (Valkey/Redis) — available to all functions on fnkit-network
ENV CACHE_URL=redis://fnkit-cache:6379

CMD ["/server"]
`,
  template: (projectName: string) => ({
    files: {
      'go.mod': `module ${projectName}

go 1.21

require github.com/functionkit/function-framework-go v0.1.0
`,
      'function.go': `package function

import (
\t"fmt"

\t"github.com/functionkit/function-framework-go/functions"
)

// ── Shared cache (Valkey/Redis) ──────────────────────────────────────
// Uncomment to use the shared cache across all functions.
// Install: go get github.com/redis/go-redis/v9
//
// import (
// \t"context"
// \t"time"
// \t"github.com/redis/go-redis/v9"
// )
//
// var cache = redis.NewClient(&redis.Options{Addr: "fnkit-cache:6379"})
//
// // Write to cache (with 5-minute TTL)
// cache.Set(context.Background(), "mykey", "value", 5*time.Minute)
//
// // Read from cache
// val, _ := cache.Get(context.Background(), "mykey").Result()
// ─────────────────────────────────────────────────────────────────────

func init() {
\tfunctions.MQTT("helloWorld", helloWorld)
}

// helloWorld is invoked when a message arrives on the MQTT topic.
func helloWorld(req *functions.MqttRequest, res functions.MqttResponse) {
\tname := "World"
\tif body, ok := req.Body.(map[string]interface{}); ok {
\t\tif n, ok := body["name"].(string); ok {
\t\t\tname = n
\t\t}
\t}
\tres.Send(map[string]string{
\t\t"message": fmt.Sprintf("Hello, %s!", name),
\t})
}

// ── Publish to another MQTT topic ────────────────────────────────────
// Uncomment to publish messages to other topics from within your function.
// Install: go get github.com/eclipse/paho.mqtt.golang
//
// import (
// \t"encoding/json"
// \tmqtt "github.com/eclipse/paho.mqtt.golang"
// )
//
// var pub mqtt.Client
//
// func init() {
// \topts := mqtt.NewClientOptions().AddBroker(os.Getenv("MQTT_BROKER"))
// \tpub = mqtt.NewClient(opts)
// \tif token := pub.Connect(); token.Wait() && token.Error() != nil {
// \t\tlog.Fatalf("publish client: %v", token.Error())
// \t}
// }
//
// func publishProcessed(req *functions.MqttRequest, res functions.MqttResponse) {
// \tpayload, _ := json.Marshal(map[string]float64{"temperature": 22.5})
// \tpub.Publish("sensors/processed", 1, false, payload)
// \tres.Send(map[string]string{"status": "published"})
// }
// ─────────────────────────────────────────────────────────────────────
`,
      'cmd/main.go': `package main

import (
\t"log"

\t// Blank-import the function package so the init() runs
\t_ "${projectName}"
\t"github.com/functionkit/function-framework-go/funcframework"
)

func main() {
\tif err := funcframework.Start(); err != nil {
\t\tlog.Fatalf("funcframework.Start: %v\\n", err)
\t}
}
`,
      '.env.example': `# MQTT broker connection
MQTT_BROKER=mqtt://localhost:1883

# Function target name
FUNCTION_TARGET=helloWorld

# Topic prefix (subscribes to {prefix}/{target})
MQTT_TOPIC_PREFIX=fnkit

# MQTT QoS level (0, 1, or 2)
MQTT_QOS=1

# MQTT client identifier (auto-generated if empty)
MQTT_CLIENT_ID=

# MQTT broker authentication
MQTT_USERNAME=
MQTT_PASSWORD=

# TLS: path to CA certificate
MQTT_CA=

# mTLS: path to client certificate and key
MQTT_CERT=
MQTT_KEY=

# Whether to reject unauthorized TLS certificates
MQTT_REJECT_UNAUTHORIZED=true

# Override subscribe topic (e.g. "v1.0/#" for wildcard). If empty, uses {prefix}/{target}
MQTT_SUBSCRIBE_TOPIC=
`,
    },
    postCreate: ['go mod tidy'],
  }),
})
