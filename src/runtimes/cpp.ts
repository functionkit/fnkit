// C++ runtime
// https://github.com/GoogleCloudPlatform/functions-framework-cpp

import { createRuntime } from './base'

export const cpp = createRuntime({
  name: 'cpp',
  displayName: 'C++',
  repo: 'https://github.com/GoogleCloudPlatform/functions-framework-cpp',
  quickstartUrl:
    'https://github.com/GoogleCloudPlatform/functions-framework-cpp/blob/main/examples/site/howto_create_container/README.md',
  checkCommand: 'g++',
  checkArgs: ['--version'],
  installHint:
    'Install g++ via Xcode Command Line Tools or use: brew install gcc',
  buildTools: [
    {
      name: 'CMake',
      command: 'cmake',
      args: ['--version'],
      installHint:
        'Install CMake from https://cmake.org or use: brew install cmake',
    },
    {
      name: 'vcpkg',
      command: 'vcpkg',
      args: ['version'],
      installHint:
        'Install vcpkg: git clone https://github.com/microsoft/vcpkg && ./vcpkg/bootstrap-vcpkg.sh',
    },
  ],
  filePatterns: ['CMakeLists.txt', '*.cc', '*.cpp', 'vcpkg.json'],
  runCommand: ['./.build/hello_world'],
  // Note: Primary build method is via pack build (buildpacks) in publish command
  // This Dockerfile is for local docker build fallback
  dockerfile: `# Multi-stage build for C++ Functions Framework
# Recommended: Use 'pack build' with Google Cloud Buildpacks instead

FROM ubuntu:22.04 AS build
LABEL fnkit.fn="true"

# Install build dependencies
RUN apt-get update && apt-get install -y \\
    build-essential \\
    cmake \\
    git \\
    curl \\
    zip \\
    unzip \\
    tar \\
    pkg-config \\
    && rm -rf /var/lib/apt/lists/*

# Install vcpkg
WORKDIR /vcpkg
RUN git clone https://github.com/microsoft/vcpkg.git . && \\
    ./bootstrap-vcpkg.sh -disableMetrics

# Build the function
WORKDIR /app
COPY vcpkg.json CMakeLists.txt ./
COPY *.cc ./

RUN cmake -S . -B .build \\
    -DCMAKE_TOOLCHAIN_FILE=/vcpkg/scripts/buildsystems/vcpkg.cmake \\
    -DCMAKE_BUILD_TYPE=Release

RUN cmake --build .build

# Runtime stage
FROM gcr.io/distroless/cc-debian12
COPY --from=build /app/.build/hello_world /hello_world
ENV PORT=8080
# Shared cache (Valkey/Redis) — available to all functions on fnkit-network
ENV CACHE_URL=redis://fnkit-cache:6379
EXPOSE 8080
CMD ["/hello_world"]
`,
  template: (projectName: string) => ({
    files: {
      'CMakeLists.txt': `cmake_minimum_required(VERSION 3.10)
project(${projectName})

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(functions_framework_cpp REQUIRED)

add_executable(hello_world hello_world.cc)
target_link_libraries(hello_world functions-framework-cpp::framework)
`,
      'hello_world.cc': `#include <google/cloud/functions/function.h>

namespace gcf = ::google::cloud::functions;

// ── Shared cache (Valkey/Redis) ──────────────────────────────────────
// Uncomment to use the shared cache across all functions.
// Add to vcpkg.json: "redis-plus-plus" and "hiredis"
//
// #include <sw/redis++/redis++.h>
//
// auto cache = sw::redis::Redis("tcp://fnkit-cache:6379");
//
// // Write to cache (with 5-minute TTL)
// cache.set("mykey", R"({"hello": "world"})", std::chrono::seconds(300));
//
// // Read from cache
// auto value = cache.get("mykey");  // returns std::optional<std::string>
// ─────────────────────────────────────────────────────────────────────

// HTTP function handler
gcf::HttpResponse hello_world_impl(gcf::HttpRequest const& /*request*/) {
  return gcf::HttpResponse{}
      .set_header("Content-Type", "text/plain")
      .set_payload("Hello, World!\\n");
}

// Function entry point - name must match GOOGLE_FUNCTION_TARGET
gcf::Function hello_world() {
  return gcf::MakeFunction(hello_world_impl);
}
`,
      'vcpkg.json': JSON.stringify(
        {
          name: projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
          version: '1.0.0',
          dependencies: ['functions-framework-cpp'],
        },
        null,
        2,
      ),
      'README.md': `# ${projectName}

A C++ function using the [Functions Framework for C++](https://github.com/GoogleCloudPlatform/functions-framework-cpp).

## Local Development

### Prerequisites

- C++17 compatible compiler (GCC >= 8 or Clang >= 10)
- CMake >= 3.10
- vcpkg

### Build locally

\`\`\`bash
# Configure with vcpkg
cmake -S . -B .build -DCMAKE_TOOLCHAIN_FILE=$HOME/vcpkg/scripts/buildsystems/vcpkg.cmake

# Build
cmake --build .build

# Run
./.build/hello_world --port 8080
\`\`\`

### Test

\`\`\`bash
curl http://localhost:8080
\`\`\`

## Build Container (Recommended)

Use Google Cloud Buildpacks:

\`\`\`bash
pack build ${projectName.toLowerCase()} \\
  --builder gcr.io/buildpacks/builder:v1 \\
  --env GOOGLE_FUNCTION_TARGET=hello_world
\`\`\`

Or use the CLI:

\`\`\`bash
fnkit publish --target hello_world
\`\`\`

## Deploy

\`\`\`bash
# Run container
docker run -p 8080:8080 ${projectName.toLowerCase()}
\`\`\`
`,
    },
    postCreate: [],
  }),
})
