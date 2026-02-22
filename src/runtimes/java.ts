// Java runtime
// https://github.com/GoogleCloudPlatform/functions-framework-java

import { createRuntime } from './base'

export const java = createRuntime({
  name: 'java',
  displayName: 'Java',
  repo: 'https://github.com/GoogleCloudPlatform/functions-framework-java',
  quickstartUrl:
    'https://github.com/GoogleCloudPlatform/functions-framework-java?tab=readme-ov-file#quickstart-hello-world-on-your-local-machine',
  checkCommand: 'java',
  checkArgs: ['--version'],
  installHint:
    'Install Java JDK from https://adoptium.net or use: brew install openjdk',
  buildTools: [
    {
      name: 'Maven',
      command: 'mvn',
      args: ['--version'],
      installHint:
        'Install Maven from https://maven.apache.org or use: brew install maven',
    },
  ],
  filePatterns: ['pom.xml', 'build.gradle'],
  runCommand: ['mvn', 'function:run'],
  dockerfile: `FROM maven:3.9-eclipse-temurin-17
LABEL fnkit.fn="true"
WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline
COPY src ./src
RUN mvn package -DskipTests
# Shared cache (Valkey/Redis) — available to all functions on fnkit-network
ENV CACHE_URL=redis://fnkit-cache:6379
EXPOSE 8080
CMD ["mvn", "function:run", "-Drun.port=8080"]

`,
  template: (projectName: string) => ({
    files: {
      'pom.xml': `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <groupId>com.example</groupId>
  <artifactId>${projectName}</artifactId>
  <version>1.0-SNAPSHOT</version>
  <packaging>jar</packaging>

  <properties>
    <maven.compiler.source>17</maven.compiler.source>
    <maven.compiler.target>17</maven.compiler.target>
  </properties>

  <dependencies>
    <dependency>
      <groupId>com.google.cloud.functions</groupId>
      <artifactId>functions-framework-api</artifactId>
      <version>1.1.4</version>
      <scope>provided</scope>
    </dependency>
  </dependencies>

  <build>
    <plugins>
      <plugin>
        <groupId>com.google.cloud.functions</groupId>
        <artifactId>function-maven-plugin</artifactId>
        <version>0.10.1</version>
        <configuration>
          <functionTarget>com.example.HelloWorld</functionTarget>
        </configuration>
      </plugin>
    </plugins>
  </build>
</project>
`,
      'src/main/java/com/example/HelloWorld.java': `package com.example;

import com.google.cloud.functions.HttpFunction;
import com.google.cloud.functions.HttpRequest;
import com.google.cloud.functions.HttpResponse;

// ── Shared cache (Valkey/Redis) ──────────────────────────────────────
// Uncomment to use the shared cache across all functions.
// Add to pom.xml: <dependency><groupId>redis.clients</groupId><artifactId>jedis</artifactId><version>5.1.0</version></dependency>
//
// import redis.clients.jedis.Jedis;
//
// Jedis cache = new Jedis("fnkit-cache", 6379);
//
// // Write to cache (with 5-minute TTL)
// cache.setex("mykey", 300, "{\\"hello\\": \\"world\\"}");
//
// // Read from cache
// String value = cache.get("mykey");
// ─────────────────────────────────────────────────────────────────────

public class HelloWorld implements HttpFunction {
  @Override
  public void service(HttpRequest request, HttpResponse response)
      throws Exception {
    response.getWriter().write("Hello, World!\\n");
  }
}
`,
    },
    postCreate: ['mvn package -DskipTests'],
  }),
})
