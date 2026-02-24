// .NET MQTT runtime
// https://github.com/functionkit/function-framework-dotnet

import { createRuntime } from './base'

export const dotnetMqtt = createRuntime({
  name: 'dotnet-mqtt',
  displayName: '.NET (MQTT)',
  repo: 'https://github.com/functionkit/function-framework-dotnet',
  quickstartUrl:
    'https://github.com/functionkit/function-framework-dotnet#readme',
  checkCommand: 'dotnet',
  checkArgs: ['--version'],
  installHint:
    'Install .NET SDK from https://dotnet.microsoft.com or use: brew install dotnet',
  filePatterns: ['*.csproj', '*.fsproj'],
  runCommand: ['dotnet', 'run'],
  dockerfile: `FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
LABEL fnkit.fn="true"
WORKDIR /src
COPY *.csproj ./
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app .

# MQTT broker connection
ENV MQTT_BROKER=mqtt://localhost:1883
# Function target name
ENV FUNCTION_TARGET=HelloWorld
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
# Shared cache (Valkey/Redis) — available to all functions on fnkit-network
ENV CACHE_URL=redis://fnkit-cache:6379

ENTRYPOINT ["dotnet", "{{PROJECT_NAME}}.dll"]
`,
  template: (projectName: string) => {
    const safeNamespace = projectName.replace(/-/g, '_')
    return {
      files: {
        [`${projectName}.csproj`]: `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="FnKit.Functions.Framework" Version="0.1.*" />
    <PackageReference Include="FnKit.Functions.Hosting" Version="0.1.*" />
  </ItemGroup>
</Project>
`,
        'Function.cs': `using FnKit.Functions.Framework;

// ── Shared cache (Valkey/Redis) ──────────────────────────────────────
// Uncomment to use the shared cache across all functions.
// Install: dotnet add package StackExchange.Redis
//
// using StackExchange.Redis;
//
// var redis = ConnectionMultiplexer.Connect("fnkit-cache:6379");
// var db = redis.GetDatabase();
//
// // Write to cache (with 5-minute TTL)
// db.StringSet("mykey", "{\\"hello\\": \\"world\\"}", TimeSpan.FromMinutes(5));
//
// // Read from cache
// string value = db.StringGet("mykey");
// ─────────────────────────────────────────────────────────────────────

namespace ${safeNamespace};

public class Function : IMqttFunction
{
    public Task HandleAsync(MqttRequest request, MqttResponse response, CancellationToken cancellationToken)
    {
        string name = "World";
        if (request.Body.HasValue)
        {
            try
            {
                if (request.Body.Value.TryGetProperty("name", out var nameProp))
                {
                    name = nameProp.GetString() ?? "World";
                }
            }
            catch
            {
                // Not a JSON object with a "name" property — use default
            }
        }

        response.Send(new { message = $"Hello, {name}!" });
        return Task.CompletedTask;
    }
}

// ── Publish to another MQTT topic ────────────────────────────────────
// Uncomment to publish messages to other topics from within your function.
// Install: dotnet add package MQTTnet
//
// using MQTTnet;
// using MQTTnet.Client;
//
// public class Publisher
// {
//     private static readonly Lazy<Task<IMqttClient>> _client = new(CreateClientAsync);
//
//     private static async Task<IMqttClient> CreateClientAsync()
//     {
//         var factory = new MqttFactory();
//         var client = factory.CreateMqttClient();
//         var broker = Environment.GetEnvironmentVariable("MQTT_BROKER") ?? "mqtt://localhost:1883";
//         var uri = new Uri(broker);
//         var options = new MqttClientOptionsBuilder()
//             .WithTcpServer(uri.Host, uri.Port)
//             .Build();
//         await client.ConnectAsync(options);
//         return client;
//     }
//
//     public static async Task PublishAsync(string topic, object payload)
//     {
//         var client = await _client.Value;
//         var json = System.Text.Json.JsonSerializer.Serialize(payload);
//         var message = new MqttApplicationMessageBuilder()
//             .WithTopic(topic)
//             .WithPayload(json)
//             .WithQualityOfServiceLevel(MQTTnet.Protocol.MqttQualityOfServiceLevel.AtLeastOnce)
//             .Build();
//         await client.PublishAsync(message);
//     }
// }
//
// // Usage inside your function:
// // await Publisher.PublishAsync("sensors/processed", new { temperature = 22.5 });
// ─────────────────────────────────────────────────────────────────────
`,
        'Program.cs': `using FnKit.Functions.Hosting;

return await EntryPoint.StartAsync(typeof(${safeNamespace}.HelloWorld).Assembly, args);
`,
        '.env.example': `# MQTT broker connection
MQTT_BROKER=mqtt://localhost:1883

# Function target name
FUNCTION_TARGET=HelloWorld

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
`,
      },
      postCreate: ['dotnet restore'],
    }
  },
})
