// MQTT Plugin — OPC-UA Bridge (opcua-bridge)
// Scaffolds a Go application that reads OPC-UA tags and publishes to MQTT
// Supports Docker deployment and cross-compiled standalone binaries (.exe)

import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import logger from '../../utils/logger'
import * as docker from '../../utils/docker'
import { exec } from '../../utils/shell'

const DEFAULT_DIR = 'opcua-bridge'
const CONTAINER_NAME = 'opcua-bridge'
const FNKIT_NETWORK = 'fnkit-network'

// ── Go Source Templates ──────────────────────────────────────────────
// Templates are defined as functions below to keep the file manageable

function generateMainGo(): string {
  return `package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	log.Println("[opcua-bridge] Starting OPC-UA → MQTT Bridge")

	// Load configuration
	cfg, err := LoadConfig()
	if err != nil {
		log.Fatalf("[opcua-bridge] Failed to load config: %v", err)
	}

	log.Printf("[opcua-bridge] Loaded %d tag group(s) with %d total tags",
		len(cfg.Groups), cfg.TotalTags())

	// Connect to MQTT broker
	mqttClient, err := NewMQTTClient(cfg)
	if err != nil {
		log.Fatalf("[opcua-bridge] Failed to connect to MQTT: %v", err)
	}
	defer mqttClient.Disconnect()
	log.Printf("[opcua-bridge] Connected to MQTT broker: %s", cfg.MQTT.Broker)

	// Publish online status
	mqttClient.PublishStatus(cfg.StatusTopic, "online", "")

	// Connect to OPC-UA server
	opcuaClient, err := NewOPCUAClient(cfg)
	if err != nil {
		mqttClient.PublishStatus(cfg.StatusTopic, "error", fmt.Sprintf("OPC-UA connect failed: %v", err))
		log.Fatalf("[opcua-bridge] Failed to connect to OPC-UA: %v", err)
	}
	defer opcuaClient.Close()
	log.Printf("[opcua-bridge] Connected to OPC-UA server: %s", cfg.OPCUA.Endpoint)

	mqttClient.PublishStatus(cfg.StatusTopic, "connected", "")

	// Context for graceful shutdown
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var wg sync.WaitGroup

	// Start each tag group
	for _, group := range cfg.Groups {
		wg.Add(1)
		go func(g TagGroup) {
			defer wg.Done()
			runGroup(ctx, opcuaClient, mqttClient, g, cfg.StatusTopic)
		}(group)
	}

	// Wait for shutdown signal
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	sig := <-sigCh
	log.Printf("[opcua-bridge] Received signal %v, shutting down...", sig)

	mqttClient.PublishStatus(cfg.StatusTopic, "offline", "graceful shutdown")
	cancel()
	wg.Wait()

	log.Println("[opcua-bridge] Shutdown complete")
}

func runGroup(ctx context.Context, opcua *OPCUAClient, mqtt *MQTTClient, group TagGroup, statusTopic string) {
	log.Printf("[opcua-bridge] Starting group %q (%s mode, %d tags, topic: %s)",
		group.Name, group.Mode, len(group.Tags), group.Topic)

	if group.Mode == "subscribe" {
		// OPC-UA subscription — real-time push from server
		err := opcua.Subscribe(ctx, group, func(data map[string]interface{}) {
			mqtt.Publish(group.Topic, data)
		})
		if err != nil {
			log.Printf("[opcua-bridge] Subscription error for group %q: %v", group.Name, err)
			mqtt.PublishStatus(statusTopic, "error",
				fmt.Sprintf("subscription failed for group %s: %v", group.Name, err))
		}
	} else {
		// Poll mode — read on interval
		interval := time.Duration(group.Interval) * time.Millisecond
		if interval < 100*time.Millisecond {
			interval = 1000 * time.Millisecond
		}

		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		// Initial read
		readAndPublish(opcua, mqtt, group, statusTopic)

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				readAndPublish(opcua, mqtt, group, statusTopic)
			}
		}
	}
}

func readAndPublish(opcua *OPCUAClient, mqtt *MQTTClient, group TagGroup, statusTopic string) {
	data, err := opcua.ReadTags(group)
	if err != nil {
		log.Printf("[opcua-bridge] Read error for group %q: %v", group.Name, err)
		mqtt.PublishStatus(statusTopic, "error",
			fmt.Sprintf("read failed for group %s: %v", group.Name, err))
		return
	}
	mqtt.Publish(group.Topic, data)
}
`
}

function generateConfigGo(): string {
  return `package main

import (
	"fmt"
	"log"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

// ── Configuration Types ──────────────────────────────────────────────

type Config struct {
	OPCUA       OPCUAConfig ` + '`yaml:"opcua"`' + `
	MQTT        MQTTConfig  ` + '`yaml:"mqtt"`' + `
	StatusTopic string      ` + '`yaml:"status_topic"`' + `
	Groups      []TagGroup  ` + '`yaml:"groups"`' + `
}

type OPCUAConfig struct {
	Endpoint       string ` + '`yaml:"endpoint"`' + `
	SecurityPolicy string ` + '`yaml:"security_policy"`' + `
	SecurityMode   string ` + '`yaml:"security_mode"`' + `
	Certificate    string ` + '`yaml:"certificate"`' + `
	PrivateKey     string ` + '`yaml:"private_key"`' + `
	Username       string ` + '`yaml:"username"`' + `
	Password       string ` + '`yaml:"password"`' + `
	Insecure       bool   ` + '`yaml:"insecure"`' + `
}

type MQTTConfig struct {
	Broker   string ` + '`yaml:"broker"`' + `
	ClientID string ` + '`yaml:"client_id"`' + `
	Username string ` + '`yaml:"username"`' + `
	Password string ` + '`yaml:"password"`' + `
	CA       string ` + '`yaml:"ca"`' + `
	Cert     string ` + '`yaml:"cert"`' + `
	Key      string ` + '`yaml:"key"`' + `
	Insecure bool   ` + '`yaml:"insecure"`' + `
	QoS      int    ` + '`yaml:"qos"`' + `
}

type TagGroup struct {
	Name     string ` + '`yaml:"name"`' + `
	Topic    string ` + '`yaml:"topic"`' + `
	Mode     string ` + '`yaml:"mode"`' + `
	Interval int    ` + '`yaml:"interval"`' + `
	Tags     []Tag  ` + '`yaml:"tags"`' + `
}

type Tag struct {
	Name   string ` + '`yaml:"name"`' + `
	NodeID string ` + '`yaml:"node_id"`' + `
}

func (c *Config) TotalTags() int {
	total := 0
	for _, g := range c.Groups {
		total += len(g.Tags)
	}
	return total
}

// ── Config Loading ───────────────────────────────────────────────────

func LoadConfig() (*Config, error) {
	// Try tags.yaml first, then fall back to env vars
	configFile := envOrDefault("CONFIG_FILE", "tags.yaml")

	data, err := os.ReadFile(configFile)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file %s: %w", configFile, err)
	}

	// Expand environment variables in the YAML
	expanded := os.ExpandEnv(string(data))

	var cfg Config
	if err := yaml.Unmarshal([]byte(expanded), &cfg); err != nil {
		return nil, fmt.Errorf("failed to parse config: %w", err)
	}

	// Apply env var overrides
	applyEnvOverrides(&cfg)

	// Validate
	if err := validateConfig(&cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}

func applyEnvOverrides(cfg *Config) {
	// OPC-UA overrides
	if v := os.Getenv("OPCUA_ENDPOINT"); v != "" {
		cfg.OPCUA.Endpoint = v
	}
	if v := os.Getenv("OPCUA_SECURITY_POLICY"); v != "" {
		cfg.OPCUA.SecurityPolicy = v
	}
	if v := os.Getenv("OPCUA_SECURITY_MODE"); v != "" {
		cfg.OPCUA.SecurityMode = v
	}
	if v := os.Getenv("OPCUA_USERNAME"); v != "" {
		cfg.OPCUA.Username = v
	}
	if v := os.Getenv("OPCUA_PASSWORD"); v != "" {
		cfg.OPCUA.Password = v
	}
	if v := os.Getenv("OPCUA_CERTIFICATE"); v != "" {
		cfg.OPCUA.Certificate = v
	}
	if v := os.Getenv("OPCUA_PRIVATE_KEY"); v != "" {
		cfg.OPCUA.PrivateKey = v
	}
	if os.Getenv("OPCUA_INSECURE") == "true" {
		cfg.OPCUA.Insecure = true
	}

	// MQTT overrides
	if v := os.Getenv("MQTT_BROKER"); v != "" {
		cfg.MQTT.Broker = v
	}
	if v := os.Getenv("MQTT_CLIENT_ID"); v != "" {
		cfg.MQTT.ClientID = v
	}
	if v := os.Getenv("MQTT_USERNAME"); v != "" {
		cfg.MQTT.Username = v
	}
	if v := os.Getenv("MQTT_PASSWORD"); v != "" {
		cfg.MQTT.Password = v
	}
	if v := os.Getenv("MQTT_CA"); v != "" {
		cfg.MQTT.CA = v
	}
	if v := os.Getenv("MQTT_CERT"); v != "" {
		cfg.MQTT.Cert = v
	}
	if v := os.Getenv("MQTT_KEY"); v != "" {
		cfg.MQTT.Key = v
	}
	if os.Getenv("MQTT_INSECURE") == "true" {
		cfg.MQTT.Insecure = true
	}

	// Status topic override
	if v := os.Getenv("STATUS_TOPIC"); v != "" {
		cfg.StatusTopic = v
	}
}

func validateConfig(cfg *Config) error {
	if cfg.OPCUA.Endpoint == "" {
		return fmt.Errorf("opcua.endpoint is required")
	}
	if cfg.MQTT.Broker == "" {
		cfg.MQTT.Broker = "mqtt://localhost:1883"
	}
	if cfg.StatusTopic == "" {
		cfg.StatusTopic = "connection/opcua-bridge"
	}
	if cfg.MQTT.QoS < 0 || cfg.MQTT.QoS > 2 {
		cfg.MQTT.QoS = 1
	}

	// Default security
	if cfg.OPCUA.SecurityPolicy == "" {
		cfg.OPCUA.SecurityPolicy = "None"
	}
	if cfg.OPCUA.SecurityMode == "" {
		cfg.OPCUA.SecurityMode = "None"
	}

	for i, g := range cfg.Groups {
		if g.Name == "" {
			cfg.Groups[i].Name = fmt.Sprintf("group-%d", i)
		}
		if g.Topic == "" {
			return fmt.Errorf("group %q: topic is required", g.Name)
		}
		if g.Mode == "" {
			cfg.Groups[i].Mode = "poll"
		}
		mode := strings.ToLower(g.Mode)
		if mode != "poll" && mode != "subscribe" {
			return fmt.Errorf("group %q: mode must be 'poll' or 'subscribe'", g.Name)
		}
		cfg.Groups[i].Mode = mode
		if len(g.Tags) == 0 {
			return fmt.Errorf("group %q: at least one tag is required", g.Name)
		}
	}

	if len(cfg.Groups) == 0 {
		return fmt.Errorf("at least one tag group is required")
	}

	return nil
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
`
}

function generateOpcuaGo(): string {
  return `package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/gopcua/opcua"
	"github.com/gopcua/opcua/monitor"
	"github.com/gopcua/opcua/ua"
)

// OPCUAClient wraps the gopcua client with connection management
type OPCUAClient struct {
	client *opcua.Client
	cfg    *Config
}

// NewOPCUAClient connects to the OPC-UA server with the configured security
func NewOPCUAClient(cfg *Config) (*OPCUAClient, error) {
	opts := []opcua.Option{
		opcua.AutoReconnect(true),
		opcua.ReconnectInterval(5 * time.Second),
		opcua.RequestTimeout(10 * time.Second),
	}

	// Security policy
	switch cfg.OPCUA.SecurityPolicy {
	case "Basic256Sha256":
		opts = append(opts, opcua.SecurityPolicy(ua.SecurityPolicyURIBasic256Sha256))
	case "Basic256":
		opts = append(opts, opcua.SecurityPolicy(ua.SecurityPolicyURIBasic256))
	case "Basic128Rsa15":
		opts = append(opts, opcua.SecurityPolicy(ua.SecurityPolicyURIBasic128Rsa15))
	default:
		opts = append(opts, opcua.SecurityPolicy(ua.SecurityPolicyURINone))
	}

	// Security mode
	switch cfg.OPCUA.SecurityMode {
	case "SignAndEncrypt":
		opts = append(opts, opcua.SecurityMode(ua.MessageSecurityModeSignAndEncrypt))
	case "Sign":
		opts = append(opts, opcua.SecurityMode(ua.MessageSecurityModeSign))
	default:
		opts = append(opts, opcua.SecurityMode(ua.MessageSecurityModeNone))
	}

	// Certificate-based authentication
	if cfg.OPCUA.Certificate != "" && cfg.OPCUA.PrivateKey != "" {
		opts = append(opts,
			opcua.CertificateFile(cfg.OPCUA.Certificate),
			opcua.PrivateKeyFile(cfg.OPCUA.PrivateKey),
		)
	}

	// Username/password authentication
	if cfg.OPCUA.Username != "" {
		opts = append(opts, opcua.AuthUsername(cfg.OPCUA.Username, cfg.OPCUA.Password))
	} else {
		opts = append(opts, opcua.AuthAnonymous())
	}

	client, err := opcua.NewClient(cfg.OPCUA.Endpoint, opts...)
	if err != nil {
		return nil, fmt.Errorf("failed to create OPC-UA client: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := client.Connect(ctx); err != nil {
		return nil, fmt.Errorf("failed to connect to %s: %w", cfg.OPCUA.Endpoint, err)
	}

	return &OPCUAClient{client: client, cfg: cfg}, nil
}

// Close disconnects from the OPC-UA server
func (c *OPCUAClient) Close() {
	if c.client != nil {
		c.client.Close(context.Background())
	}
}

// ReadTags reads all tags in a group and returns a map of name → value
func (c *OPCUAClient) ReadTags(group TagGroup) (map[string]interface{}, error) {
	// Build read request
	nodesToRead := make([]*ua.ReadValueID, len(group.Tags))
	for i, tag := range group.Tags {
		id, err := ua.ParseNodeID(tag.NodeID)
		if err != nil {
			return nil, fmt.Errorf("invalid node ID %q for tag %q: %w", tag.NodeID, tag.Name, err)
		}
		nodesToRead[i] = &ua.ReadValueID{
			NodeID: id,
		}
	}

	req := &ua.ReadRequest{
		MaxAge:             2000,
		NodesToRead:        nodesToRead,
		TimestampsToReturn: ua.TimestampsToReturnBoth,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	resp, err := c.client.Read(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("read failed: %w", err)
	}

	if resp.Results == nil {
		return nil, fmt.Errorf("read returned nil results")
	}

	// Build result map
	data := make(map[string]interface{})
	data["_timestamp"] = time.Now().UTC().Format(time.RFC3339Nano)

	for i, result := range resp.Results {
		if i >= len(group.Tags) {
			break
		}
		tag := group.Tags[i]

		if result.Status != ua.StatusOK {
			data[tag.Name] = nil
			log.Printf("[opcua-bridge] Tag %q status: %v", tag.Name, result.Status)
			continue
		}

		data[tag.Name] = result.Value.Value()
	}

	return data, nil
}

// Subscribe creates an OPC-UA subscription for real-time tag updates
func (c *OPCUAClient) Subscribe(ctx context.Context, group TagGroup, callback func(map[string]interface{})) error {
	m, err := monitor.NewNodeMonitor(c.client)
	if err != nil {
		return fmt.Errorf("failed to create node monitor: %w", err)
	}

	// Collect current values in a map, publish on any change
	values := make(map[string]interface{})
	values["_timestamp"] = time.Now().UTC().Format(time.RFC3339Nano)

	ch := make(chan *monitor.DataChangeMessage, 256)

	// Create monitored items for each tag
	for _, tag := range group.Tags {
		sub, err := m.Subscribe(ctx,
			&opcua.SubscriptionParameters{
				Interval: time.Duration(group.Interval) * time.Millisecond,
			},
			func(s *monitor.Subscription, dcm *monitor.DataChangeMessage) {
				ch <- dcm
			},
			tag.NodeID,
		)
		if err != nil {
			return fmt.Errorf("failed to subscribe to %q (%s): %w", tag.Name, tag.NodeID, err)
		}
		defer sub.Unsubscribe(ctx)
	}

	log.Printf("[opcua-bridge] Subscribed to %d tags in group %q", len(group.Tags), group.Name)

	// Process incoming data changes
	for {
		select {
		case <-ctx.Done():
			return nil
		case msg := <-ch:
			if msg.Error != nil {
				log.Printf("[opcua-bridge] Subscription data error: %v", msg.Error)
				continue
			}

			// Find tag name by node ID
			tagName := msg.NodeID.String()
			for _, tag := range group.Tags {
				if tag.NodeID == msg.NodeID.String() {
					tagName = tag.Name
					break
				}
			}

			values[tagName] = msg.Value.Value()
			values["_timestamp"] = time.Now().UTC().Format(time.RFC3339Nano)

			// Publish the full snapshot
			snapshot := make(map[string]interface{})
			for k, v := range values {
				snapshot[k] = v
			}
			callback(snapshot)
		}
	}
}

// loadTLSConfig creates a TLS config for OPC-UA (used internally if needed)
func loadTLSConfig(caFile, certFile, keyFile string, insecure bool) (*tls.Config, error) {
	tlsConfig := &tls.Config{
		InsecureSkipVerify: insecure,
	}

	if caFile != "" {
		caCert, err := os.ReadFile(caFile)
		if err != nil {
			return nil, fmt.Errorf("failed to read CA cert: %w", err)
		}
		caCertPool := x509.NewCertPool()
		caCertPool.AppendCertsFromPEM(caCert)
		tlsConfig.RootCAs = caCertPool
	}

	if certFile != "" && keyFile != "" {
		cert, err := tls.LoadX509KeyPair(certFile, keyFile)
		if err != nil {
			return nil, fmt.Errorf("failed to load client cert: %w", err)
		}
		tlsConfig.Certificates = []tls.Certificate{cert}
	}

	return tlsConfig, nil
}
`
}

function generateMqttGo(): string {
  return `package main

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

// MQTTClient wraps the Paho MQTT client
type MQTTClient struct {
	client mqtt.Client
	cfg    *Config
}

// NewMQTTClient connects to the MQTT broker
func NewMQTTClient(cfg *Config) (*MQTTClient, error) {
	brokerURL, err := url.Parse(cfg.MQTT.Broker)
	if err != nil {
		return nil, fmt.Errorf("invalid MQTT broker URL: %w", err)
	}

	opts := mqtt.NewClientOptions()

	// Determine scheme
	scheme := brokerURL.Scheme
	host := brokerURL.Host
	if host == "" {
		host = "localhost:1883"
	}

	switch scheme {
	case "mqtts", "ssl", "tls":
		opts.AddBroker("ssl://" + host)
	case "ws":
		opts.AddBroker("ws://" + host)
	case "wss":
		opts.AddBroker("wss://" + host)
	default:
		opts.AddBroker("tcp://" + host)
	}

	// Client ID
	clientID := cfg.MQTT.ClientID
	if clientID == "" {
		clientID = fmt.Sprintf("opcua-bridge-%d", time.Now().UnixNano()%100000)
	}
	opts.SetClientID(clientID)

	// Authentication
	if cfg.MQTT.Username != "" {
		opts.SetUsername(cfg.MQTT.Username)
		opts.SetPassword(cfg.MQTT.Password)
	}

	// TLS configuration
	if cfg.MQTT.CA != "" || cfg.MQTT.Cert != "" || cfg.MQTT.Insecure ||
		scheme == "mqtts" || scheme == "ssl" || scheme == "tls" {
		tlsConfig, err := buildMQTTTLSConfig(cfg)
		if err != nil {
			return nil, fmt.Errorf("failed to configure MQTT TLS: %w", err)
		}
		opts.SetTLSConfig(tlsConfig)
	}

	// Connection options
	opts.SetAutoReconnect(true)
	opts.SetMaxReconnectInterval(30 * time.Second)
	opts.SetConnectRetry(true)
	opts.SetConnectRetryInterval(5 * time.Second)
	opts.SetKeepAlive(60 * time.Second)
	opts.SetCleanSession(true)

	// Logging callbacks
	opts.SetConnectionLostHandler(func(c mqtt.Client, err error) {
		log.Printf("[opcua-bridge] MQTT connection lost: %v", err)
	})
	opts.SetReconnectingHandler(func(c mqtt.Client, opts *mqtt.ClientOptions) {
		log.Println("[opcua-bridge] MQTT reconnecting...")
	})
	opts.SetOnConnectHandler(func(c mqtt.Client) {
		log.Println("[opcua-bridge] MQTT connected")
	})

	client := mqtt.NewClient(opts)
	token := client.Connect()
	if !token.WaitTimeout(15 * time.Second) {
		return nil, fmt.Errorf("MQTT connection timeout")
	}
	if token.Error() != nil {
		return nil, fmt.Errorf("MQTT connection failed: %w", token.Error())
	}

	return &MQTTClient{client: client, cfg: cfg}, nil
}

// Publish sends a JSON payload to the specified MQTT topic
func (m *MQTTClient) Publish(topic string, data map[string]interface{}) {
	payload, err := json.Marshal(data)
	if err != nil {
		log.Printf("[opcua-bridge] Failed to marshal data for topic %s: %v", topic, err)
		return
	}

	token := m.client.Publish(topic, byte(m.cfg.MQTT.QoS), false, payload)
	if !token.WaitTimeout(5 * time.Second) {
		log.Printf("[opcua-bridge] MQTT publish timeout for topic %s", topic)
		return
	}
	if token.Error() != nil {
		log.Printf("[opcua-bridge] MQTT publish error for topic %s: %v", topic, token.Error())
	}
}

// PublishStatus sends a status message to the status topic
func (m *MQTTClient) PublishStatus(topic, status, detail string) {
	if topic == "" {
		return
	}

	msg := map[string]interface{}{
		"status":    status,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}
	if detail != "" {
		msg["detail"] = detail
	}

	payload, _ := json.Marshal(msg)
	m.client.Publish(topic, byte(m.cfg.MQTT.QoS), true, payload)
}

// Disconnect cleanly disconnects from the MQTT broker
func (m *MQTTClient) Disconnect() {
	if m.client != nil && m.client.IsConnected() {
		m.client.Disconnect(1000)
	}
}

func buildMQTTTLSConfig(cfg *Config) (*tls.Config, error) {
	tlsConfig := &tls.Config{
		InsecureSkipVerify: cfg.MQTT.Insecure,
	}

	// CA certificate
	if cfg.MQTT.CA != "" {
		caCert, err := os.ReadFile(cfg.MQTT.CA)
		if err != nil {
			return nil, fmt.Errorf("failed to read MQTT CA cert %s: %w", cfg.MQTT.CA, err)
		}
		caCertPool := x509.NewCertPool()
		caCertPool.AppendCertsFromPEM(caCert)
		tlsConfig.RootCAs = caCertPool
	}

	// Client certificate (mTLS)
	if cfg.MQTT.Cert != "" && cfg.MQTT.Key != "" {
		cert, err := tls.LoadX509KeyPair(cfg.MQTT.Cert, cfg.MQTT.Key)
		if err != nil {
			return nil, fmt.Errorf("failed to load MQTT client cert: %w", err)
		}
		tlsConfig.Certificates = []tls.Certificate{cert}
	}

	return tlsConfig, nil
}
`
}

function generateGoMod(): string {
  return `module opcua-bridge

go 1.21

require (
	github.com/eclipse/paho.mqtt.golang v1.4.3
	github.com/gopcua/opcua v0.5.3
	gopkg.in/yaml.v3 v3.0.1
)
`
}

function generateDockerfile(): string {
  return `# ── Builder stage: cross-compile for all platforms ────────────────────
FROM golang:1.21 AS builder
LABEL fnkit.fn="true"
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN go mod tidy

# Linux amd64 (Docker runtime)
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o dist/opcua-bridge-linux-amd64 .

# Linux arm64
RUN CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o dist/opcua-bridge-linux-arm64 .

# Windows amd64 (.exe for edge deployment)
RUN CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o dist/opcua-bridge-windows-amd64.exe .

# macOS arm64
RUN CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o dist/opcua-bridge-darwin-arm64 .

# ── Runtime stage: minimal container ─────────────────────────────────
FROM gcr.io/distroless/static-debian11
COPY --from=builder /app/dist/opcua-bridge-linux-amd64 /opcua-bridge
COPY --from=builder /app/tags.yaml /tags.yaml

CMD ["/opcua-bridge"]
`
}

function generateDockerCompose(name: string): string {
  return `# Docker Compose for opcua-bridge — OPC-UA → MQTT Bridge
# Reads OPC-UA tags and publishes to MQTT topics
#
# Requires: docker network create fnkit-network

services:
  ${name}:
    build: .
    container_name: ${name}
    env_file:
      - .env
    volumes:
      # Mount tag configuration
      - ./tags.yaml:/tags.yaml:ro
      # Mount certificates for OPC-UA and MQTT TLS
      - ./certs:/certs:ro
    networks:
      - fnkit-network
    restart: unless-stopped

networks:
  fnkit-network:
    name: fnkit-network
    external: true

# Usage:
#   1. Edit tags.yaml with your OPC-UA tags and MQTT topics
#   2. Copy .env.example to .env and configure overrides
#   3. Place TLS certificates in ./certs/ (if using TLS)
#   4. docker compose up -d
#
# Build standalone binaries:
#   fnkit mqtt opcua build
#   → dist/opcua-bridge-windows-amd64.exe  (edge deployment)
#   → dist/opcua-bridge-linux-amd64        (Linux server)
`
}

function generateTagsYaml(): string {
  return `# OPC-UA → MQTT Bridge Configuration
# Tags are grouped by MQTT topic and read mode (poll or subscribe)
# Environment variables can be used: $OPCUA_ENDPOINT, $MQTT_BROKER, etc.

opcua:
  endpoint: "opc.tcp://172.25.131.152:4840/"
  security_policy: "Basic256Sha256"     # None | Basic256Sha256 | Basic256 | Basic128Rsa15
  security_mode: "SignAndEncrypt"        # None | Sign | SignAndEncrypt
  certificate: ""                        # Path to OPC-UA client certificate
  private_key: ""                        # Path to OPC-UA client private key
  username: ""                           # OPC-UA username (if using user/pass auth)
  password: ""                           # OPC-UA password
  insecure: false                        # Skip certificate validation

mqtt:
  broker: "mqtt://localhost:1883"        # mqtt:// | mqtts:// | ws:// | wss://
  client_id: "mill8-bridge"
  username: ""
  password: ""
  ca: ""                                 # CA certificate path (TLS)
  cert: ""                               # Client certificate path (mTLS)
  key: ""                                # Client private key path (mTLS)
  insecure: false                        # Skip TLS certificate validation
  qos: 1                                 # 0 = at most once, 1 = at least once, 2 = exactly once

status_topic: "connection/mill8"         # Connection health published here

groups:
  # ── Machine Data (real-time subscription) ───────────────────────────
  - name: "machine-data"
    topic: "legacy/mill8"
    mode: "subscribe"                    # OPC-UA subscription (real-time push)
    interval: 1000                       # Subscription publish interval (ms)
    tags:
      - name: "progName"
        node_id: "ns=2;s=/Channel/ProgramInfo/progName"
      - name: "Mode of Machine"
        node_id: "ns=2;s=/Bag/State/opMode"
      - name: "Program Status"
        node_id: "ns=2;s=/Channel/State/progStatus"
      - name: "Spindle Speed"
        node_id: "ns=2;s=/Channel/Spindle/cmdSpeed"
      - name: "Tool No"
        node_id: "ns=2;s=/Channel/State/actTNumber"
      - name: "Feed Rate"
        node_id: "ns=2;s=/Channel/State/cmdFeedRateIpo"
      - name: "Feed Rate Override"
        node_id: "ns=2;s=/Channel/State/feedRateIpoOvr"
      - name: "XMR RESET"
        node_id: "ns=2;s=/NC/_N_CH_GD2_ACX/XMR_RESET"
      - name: "XMR X deviation"
        node_id: "ns=2;s=/NC/_N_CH_GD2_ACX/XMR_X"
      - name: "XMR Y deviation"
        node_id: "ns=2;s=/NC/_N_CH_GD2_ACX/XMR_Y"
      - name: "XMR Z deviation"
        node_id: "ns=2;s=/NC/_N_CH_GD2_ACX/XMR_Z"
      - name: "XMR CX deviation"
        node_id: "ns=2;s=/NC/_N_CH_GD2_ACX/XMR_CX"
      - name: "XMR CY deviation"
        node_id: "ns=2;s=/NC/_N_CH_GD2_ACX/XMR_CY"
      - name: "XMR B Axis Backlash"
        node_id: "ns=2;s=/NC/_N_CH_GD2_ACX/XMR_BL"
      - name: "Part No."
        node_id: "ns=2;s=/NC/_N_NC_GD2_ACX/PART"
      - name: "Stage"
        node_id: "ns=2;s=/NC/_N_NC_GD2_ACX/STAGE"
      - name: "Lid"
        node_id: "ns=2;s=/NC/_N_NC_GD2_ACX/LID"
      - name: "Calling Program"
        node_id: "ns=2;s=/NC/_N_NC_GD2_ACX/DESCRIPTION"
      - name: "XMR Time"
        node_id: "ns=2;s=/NC/_N_NC_GD2_ACX/XMR_TIME"
      - name: "XMR Status"
        node_id: "ns=2;s=/NC/_N_CH_GD2_ACX/XMR_STATUS"
      - name: "Cycle Time"
        node_id: "ns=2;s=/NC/_N_CH_GD2_ACX/STAGE_CYCLE_TIME"
      - name: "T1 CompData"
        node_id: "ns=2;s=/Tool/Compensation/edgeData[u1,c1,1,12]"
      - name: "T2 CompData"
        node_id: "ns=2;s=/Tool/Compensation/edgeData[u1,c2,1,12]"
      - name: "T3 CompData"
        node_id: "ns=2;s=/Tool/Compensation/edgeData[u1,c3,1,12]"
      - name: "T4 CompData"
        node_id: "ns=2;s=/Tool/Compensation/edgeData[u1,c4,1,12]"
      - name: "T5 CompData"
        node_id: "ns=2;s=/Tool/Compensation/edgeData[u1,c5,1,12]"
      - name: "T6 CompData"
        node_id: "ns=2;s=/Tool/Compensation/edgeData[u1,c6,1,12]"
      - name: "T7 CompData"
        node_id: "ns=2;s=/Tool/Compensation/edgeData[u1,c7,1,12]"
      - name: "T1 SupData"
        node_id: "ns=2;s=/Tool/Supervision/data[u1,c1,1,5]"
      - name: "T2 SupData"
        node_id: "ns=2;s=/Tool/Supervision/data[u1,c2,1,5]"
      - name: "T3 SupData"
        node_id: "ns=2;s=/Tool/Supervision/data[u1,c3,1,5]"
      - name: "T4 SupData"
        node_id: "ns=2;s=/Tool/Supervision/data[u1,c4,1,5]"
      - name: "T5 SupData"
        node_id: "ns=2;s=/Tool/Supervision/data[u1,c5,1,5]"
      - name: "T6 SupData"
        node_id: "ns=2;s=/Tool/Supervision/data[u1,c6,1,5]"
      - name: "T7 SupData"
        node_id: "ns=2;s=/Tool/Supervision/data[u1,c7,1,5]"
      - name: "Spindle Vibration"
        node_id: "ns=2;s=/NC/_N_CH_GD2_ACX/VG_SPINDLE_VIBRATION"

  # ── Condition Monitoring (poll every 60s) ───────────────────────────
  - name: "condition-monitoring"
    topic: "condition_legacy/mill8"
    mode: "poll"                         # OPC-UA read on interval
    interval: 60000                      # 60 seconds
    tags:
      - name: "X Motor Temp"
        node_id: "ns=2;s=/DriveVsa/Drive/R0035[u3]"
      - name: "Y Motor Temp"
        node_id: "ns=2;s=/DriveVsa/Drive/R0035[u1]"
      - name: "Y1 Motor Temp"
        node_id: "ns=2;s=/DriveVsa/Drive/R0035[u2]"
      - name: "Z Motor Temp"
        node_id: "ns=2;s=/DriveVsa/Drive/R0035[u4]"
      - name: "B Motor Temp"
        node_id: "ns=2;s=/DriveVsa/Drive/R0035[u5]"
      - name: "C Motor Temp"
        node_id: "ns=2;s=/DriveVsa/Drive/R0035[u6]"
      - name: "Spindle Temp"
        node_id: "ns=2;s=/DriveVsa/Drive/R0035[u19]"

  # ── Motor Torque & Power (poll every 10s) ───────────────────────────
  - name: "motor-torque-power"
    topic: "motor_legacy/mill8"
    mode: "poll"                         # OPC-UA read on interval
    interval: 10000                      # 10 seconds
    tags:
      - name: "X Motor Torque"
        node_id: "ns=2;s=/DriveVsa/Drive/R0081[u3]"
      - name: "Y1 Motor Torque"
        node_id: "ns=2;s=/DriveVsa/Drive/R0081[u1]"
      - name: "Y2 Motor Torque"
        node_id: "ns=2;s=/DriveVsa/Drive/R0081[u2]"
      - name: "Z Motor Torque"
        node_id: "ns=2;s=/DriveVsa/Drive/R0081[u4]"
      - name: "B Motor Torque"
        node_id: "ns=2;s=/DriveVsa/Drive/R0081[u5]"
      - name: "C Motor Torque"
        node_id: "ns=2;s=/DriveVsa/Drive/R0081[u6]"
      - name: "X Voltage"
        node_id: "ns=2;s=/DriveVsa/DC/R0026[u3]"
      - name: "Y1 Voltage"
        node_id: "ns=2;s=/DriveVsa/DC/R0026[u1]"
      - name: "Y2 Voltage"
        node_id: "ns=2;s=/DriveVsa/DC/R0026[u2]"
      - name: "Z Voltage"
        node_id: "ns=2;s=/DriveVsa/DC/R0026[u4]"
      - name: "B Voltage"
        node_id: "ns=2;s=/DriveVsa/DC/R0026[u5]"
      - name: "C Voltage"
        node_id: "ns=2;s=/DriveVsa/DC/R0026[u6]"
      - name: "X Current"
        node_id: "ns=2;s=/DriveVsa/DC/R0027[u3]"
      - name: "Y1 Current"
        node_id: "ns=2;s=/DriveVsa/DC/R0027[u1]"
      - name: "Y2 Current"
        node_id: "ns=2;s=/DriveVsa/DC/R0027[u2]"
      - name: "Z Current"
        node_id: "ns=2;s=/DriveVsa/DC/R0027[u4]"
      - name: "B Current"
        node_id: "ns=2;s=/DriveVsa/DC/R0027[u5]"
      - name: "C Current"
        node_id: "ns=2;s=/DriveVsa/DC/R0027[u6]"
`
}

function generateTagsYamlExample(): string {
  return `# OPC-UA → MQTT Bridge Configuration — Example Template
# Copy this to tags.yaml and edit for your machine
#
# Environment variables are supported: $OPCUA_ENDPOINT, $MQTT_BROKER, etc.
# Or override via .env file: OPCUA_ENDPOINT=opc.tcp://...

opcua:
  endpoint: "opc.tcp://192.168.1.100:4840/"
  security_policy: "None"               # None | Basic256Sha256 | Basic256 | Basic128Rsa15
  security_mode: "None"                  # None | Sign | SignAndEncrypt
  certificate: ""                        # /certs/opcua-client.crt
  private_key: ""                        # /certs/opcua-client.key
  username: ""
  password: ""
  insecure: true                         # Set true for development / no certs

mqtt:
  broker: "mqtt://localhost:1883"
  client_id: "my-bridge"
  username: ""
  password: ""
  ca: ""                                 # /certs/mqtt-ca.crt
  cert: ""                               # /certs/mqtt-client.crt
  key: ""                                # /certs/mqtt-client.key
  insecure: false
  qos: 1

status_topic: "connection/my-bridge"

groups:
  - name: "example-group"
    topic: "data/my-machine"
    mode: "poll"                         # poll | subscribe
    interval: 5000                       # milliseconds
    tags:
      - name: "Temperature"
        node_id: "ns=2;s=Temperature"
      - name: "Pressure"
        node_id: "ns=2;s=Pressure"
`
}

function generateEnvExample(): string {
  return `# ── OPC-UA Connection Overrides ────────────────────────────────────────
# These override values in tags.yaml (useful for Docker/CI environments)
# OPCUA_ENDPOINT=opc.tcp://172.25.131.152:4840/
# OPCUA_SECURITY_POLICY=Basic256Sha256
# OPCUA_SECURITY_MODE=SignAndEncrypt
# OPCUA_USERNAME=
# OPCUA_PASSWORD=
# OPCUA_CERTIFICATE=/certs/opcua-client.crt
# OPCUA_PRIVATE_KEY=/certs/opcua-client.key
# OPCUA_INSECURE=false

# ── MQTT Connection Overrides ─────────────────────────────────────────
# MQTT_BROKER=mqtt://localhost:1883
# MQTT_CLIENT_ID=mill8-bridge
# MQTT_USERNAME=
# MQTT_PASSWORD=
# MQTT_CA=/certs/mqtt-ca.crt
# MQTT_CERT=/certs/mqtt-client.crt
# MQTT_KEY=/certs/mqtt-client.key
# MQTT_INSECURE=false

# ── Status Topic Override ─────────────────────────────────────────────
# STATUS_TOPIC=connection/mill8

# ── Config File Override ──────────────────────────────────────────────
# CONFIG_FILE=tags.yaml
`
}

function generateGitignore(): string {
  return `# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Go
vendor/

# Built binaries
dist/*
!dist/.gitkeep

# Environment
.env

# Certificates (keep .gitkeep)
certs/*.crt
certs/*.key
certs/*.pem
!certs/.gitkeep

# Tags config (may contain sensitive endpoints)
# Uncomment if you don't want to track tags.yaml in git:
# tags.yaml
`
}

function generateReadme(name: string): string {
  return `# $\{name} — OPC-UA → MQTT Bridge

A Go application that connects to an OPC-UA server, reads tags, and publishes data to MQTT topics. Runs as a Docker container or a standalone binary (.exe) on edge devices.

Scaffolded with \`fnkit mqtt opcua init\`.

## Architecture

\`\`\`
OPC-UA Server (opc.tcp://...)
    │
    │  Read / Subscribe
    │
    ▼
┌──────────────────────────────────────┐
│  $\{name}                             │
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
    │  MQTT Publish
    │
    ▼
MQTT Broker (mqtt://...)
\`\`\`

## Quick Start (Docker)

\`\`\`bash
# Edit tag configuration
vi tags.yaml

# Configure connection overrides (optional)
cp .env.example .env
vi .env

# Build and start
docker compose up -d

# Check logs
docker logs -f $\{name}
\`\`\`

## Quick Start (Standalone Binary)

\`\`\`bash
# Build binaries for all platforms
fnkit mqtt opcua build

# Deploy to edge machine
# Copy these files to the target:
#   dist/opcua-bridge-windows-amd64.exe
#   tags.yaml
#   certs/  (if using TLS)

# Run on the edge machine
./opcua-bridge-windows-amd64.exe
\`\`\`

## Configuration

All configuration is in \`tags.yaml\`. Environment variables can override connection settings.

### OPC-UA Security Modes

| Security Policy | Security Mode    | Use Case                    |
|-----------------|------------------|-----------------------------|
| None            | None             | Development / testing       |
| Basic256Sha256  | Sign             | Signed messages             |
| Basic256Sha256  | SignAndEncrypt   | Full encryption (production)|

### MQTT Protocols

| Scheme    | Port | Description          |
|-----------|------|----------------------|
| mqtt://   | 1883 | Plain MQTT           |
| mqtts://  | 8883 | MQTT over TLS        |
| ws://     | 80   | MQTT over WebSocket  |
| wss://    | 443  | MQTT over WSS (TLS)  |

### Tag Group Modes

| Mode      | Description                                          |
|-----------|------------------------------------------------------|
| poll      | Read tags on a fixed interval (e.g. every 10s, 60s)  |
| subscribe | OPC-UA subscription — server pushes changes in real-time |

## TLS / Certificates

Place certificates in the \`certs/\` directory:

\`\`\`bash
# OPC-UA client certificate
certs/opcua-client.crt
certs/opcua-client.key

# MQTT TLS
certs/mqtt-ca.crt
certs/mqtt-client.crt    # for mTLS
certs/mqtt-client.key    # for mTLS
\`\`\`

Update paths in \`tags.yaml\` or \`.env\`.

## Environment Variable Overrides

| Variable               | Description                        |
|------------------------|------------------------------------|
| OPCUA_ENDPOINT         | OPC-UA server endpoint             |
| OPCUA_SECURITY_POLICY  | None / Basic256Sha256 / Basic256   |
| OPCUA_SECURITY_MODE    | None / Sign / SignAndEncrypt       |
| OPCUA_USERNAME         | OPC-UA username                    |
| OPCUA_PASSWORD         | OPC-UA password                    |
| OPCUA_CERTIFICATE      | Path to OPC-UA client cert         |
| OPCUA_PRIVATE_KEY      | Path to OPC-UA client key          |
| OPCUA_INSECURE         | Skip OPC-UA cert validation        |
| MQTT_BROKER            | MQTT broker URL                    |
| MQTT_CLIENT_ID         | MQTT client identifier             |
| MQTT_USERNAME          | MQTT username                      |
| MQTT_PASSWORD          | MQTT password                      |
| MQTT_CA                | MQTT CA certificate path           |
| MQTT_CERT              | MQTT client certificate (mTLS)     |
| MQTT_KEY               | MQTT client key (mTLS)             |
| MQTT_INSECURE          | Skip MQTT TLS validation           |
| STATUS_TOPIC           | Connection status MQTT topic       |
| CONFIG_FILE            | Path to tags.yaml (default: tags.yaml) |

## Built With

- [gopcua/opcua](https://github.com/gopcua/opcua) — OPC-UA client library
- [eclipse/paho.mqtt.golang](https://github.com/eclipse/paho.mqtt.golang) — MQTT client
- [gopkg.in/yaml.v3](https://gopkg.in/yaml.v3) — YAML configuration
- [fnkit](https://github.com/functionkit/fnkit) — Functions as a Service CLI
`
}

// ── Command Handlers ─────────────────────────────────────────────────

export async function opcuaInit(
  args: string[],
  options: Record<string, string | boolean>,
): Promise<boolean> {
  const name = args[0] || DEFAULT_DIR
  const targetDir = resolve(process.cwd(), name)

  logger.title('Creating OPC-UA → MQTT Bridge')

  if (existsSync(targetDir)) {
    logger.error(`Directory already exists: ${name}`)
    return false
  }

  // Create directories
  mkdirSync(targetDir, { recursive: true })
  mkdirSync(join(targetDir, 'certs'), { recursive: true })
  mkdirSync(join(targetDir, 'dist'), { recursive: true })

  // Write files
  const files: Record<string, string> = {
    'main.go': generateMainGo(),
    'config.go': generateConfigGo(),
    'opcua.go': generateOpcuaGo(),
    'mqtt.go': generateMqttGo(),
    'go.mod': generateGoMod(),
    'Dockerfile': generateDockerfile(),
    'docker-compose.yml': generateDockerCompose(name),
    'tags.yaml': generateTagsYaml(),
    'tags.yaml.example': generateTagsYamlExample(),
    '.env.example': generateEnvExample(),
    '.gitignore': generateGitignore(),
    'certs/.gitkeep': '',
    'dist/.gitkeep': '',
    'README.md': generateReadme(name),
  }

  for (const [filename, content] of Object.entries(files)) {
    const filePath = join(targetDir, filename)
    const dir = join(targetDir, filename.split('/').slice(0, -1).join('/'))
    if (dir !== targetDir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(filePath, content)
    logger.success(`Created ${filename}`)
  }

  logger.newline()
  logger.success(`OPC-UA bridge created in ${name}/`)
  logger.newline()
  logger.info('Next steps:')
  logger.dim(`  cd ${name}`)
  logger.dim('  cp .env.example .env')
  logger.dim('  # Edit tags.yaml with your OPC-UA tags')
  logger.dim('  # Edit .env with your connection details')
  logger.dim('  docker compose up -d')
  logger.newline()
  logger.info('To build standalone binaries:')
  logger.dim(`  fnkit mqtt opcua build ${name}`)
  logger.newline()

  return true
}

export async function opcuaStart(
  args: string[],
  options: Record<string, string | boolean>,
): Promise<boolean> {
  const dir = args[0] || DEFAULT_DIR
  const targetDir = resolve(process.cwd(), dir)

  logger.title('Starting OPC-UA → MQTT Bridge')

  if (!existsSync(targetDir)) {
    logger.error(`Directory not found: ${dir}`)
    logger.info('Run "fnkit mqtt opcua init" first')
    return false
  }

  if (!(await docker.isDockerAvailable()) || !(await docker.isDockerRunning())) {
    logger.error('Docker is not available')
    return false
  }

  // Ensure network exists
  await exec('docker', ['network', 'create', FNKIT_NETWORK])

  // Build and start with docker compose
  logger.step('Building and starting...')
  const { execStream } = await import('../../utils/shell')
  const exitCode = await execStream('docker', ['compose', 'up', '-d', '--build'], {
    cwd: targetDir,
  })

  if (exitCode === 0) {
    logger.newline()
    logger.success('OPC-UA bridge started')
    logger.dim('  Reading OPC-UA tags and publishing to MQTT')
    logger.dim(`  Logs: docker logs -f ${dir}`)
    return true
  }

  logger.error('Failed to start OPC-UA bridge')
  return false
}

export async function opcuaStop(
  args: string[],
  options: Record<string, string | boolean>,
): Promise<boolean> {
  const name = args[0] || CONTAINER_NAME

  logger.title('Stopping OPC-UA → MQTT Bridge')

  const result = await exec('docker', ['rm', '-f', name])

  if (result.success) {
    logger.success(`Stopped: ${name}`)
    return true
  }

  logger.error(`Failed to stop ${name} (may not be running)`)
  return false
}

export async function opcuaBuild(
  args: string[],
  options: Record<string, string | boolean>,
): Promise<boolean> {
  const dir = args[0] || DEFAULT_DIR
  const targetDir = resolve(process.cwd(), dir)

  logger.title('Building OPC-UA Bridge Binaries')

  if (!existsSync(targetDir)) {
    logger.error(`Directory not found: ${dir}`)
    logger.info('Run "fnkit mqtt opcua init" first')
    return false
  }

  if (!(await docker.isDockerAvailable()) || !(await docker.isDockerRunning())) {
    logger.error('Docker is not available')
    return false
  }

  const builderImage = `${dir}-builder`

  // Build the builder image (which cross-compiles all binaries)
  logger.step('Building cross-platform binaries via Docker...')
  const { execStream } = await import('../../utils/shell')

  const buildExitCode = await execStream('docker', [
    'build',
    '--target', 'builder',
    '-t', builderImage,
    '.',
  ], { cwd: targetDir })

  if (buildExitCode !== 0) {
    logger.error('Failed to build binaries')
    return false
  }

  // Extract binaries from builder container
  const platforms = [
    { file: 'opcua-bridge-linux-amd64', desc: 'Linux x64' },
    { file: 'opcua-bridge-linux-arm64', desc: 'Linux ARM64' },
    { file: 'opcua-bridge-windows-amd64.exe', desc: 'Windows x64' },
    { file: 'opcua-bridge-darwin-arm64', desc: 'macOS ARM64' },
  ]

  // Create a temporary container to copy files out
  const containerName = `${dir}-extract-${Date.now()}`
  await exec('docker', ['create', '--name', containerName, builderImage])

  for (const platform of platforms) {
    const copyResult = await exec('docker', [
      'cp',
      `${containerName}:/app/dist/${platform.file}`,
      join(targetDir, 'dist', platform.file),
    ])

    if (copyResult.success) {
      logger.success(`Built: dist/${platform.file} (${platform.desc})`)
    } else {
      logger.warn(`Failed to extract: ${platform.file}`)
    }
  }

  // Cleanup temp container
  await exec('docker', ['rm', containerName])

  logger.newline()
  logger.success('Binaries built in dist/')
  logger.newline()
  logger.info('Deploy to edge:')
  logger.dim(`  Copy dist/opcua-bridge-windows-amd64.exe to the target machine`)
  logger.dim(`  Copy tags.yaml and .env alongside the binary`)
  logger.dim(`  Copy certs/ directory if using TLS`)
  logger.dim(`  Run: opcua-bridge-windows-amd64.exe`)
  logger.newline()

  return true
}

export async function opcuaStatus(): Promise<boolean> {
  const result = await exec('docker', [
    'ps',
    '--filter',
    `name=${CONTAINER_NAME}`,
    '--format',
    '{{.Names}}\t{{.Status}}\t{{.State}}',
  ])

  if (result.success && result.stdout.trim()) {
    const [name, status, state] = result.stdout.trim().split('\t')
    logger.success(`${name}: ${status} (${state})`)
    return true
  }

  logger.dim('opcua-bridge: not running')
  return true
}
