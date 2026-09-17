# Android build environment for the Expo app: JDK 21, Android SDK/NDK and pnpm.
# Building this image accepts the Android SDK licences non-interactively.
FROM node:24-bookworm-slim AS node
FROM eclipse-temurin:21-jdk
# Node (for Expo prebuild and pnpm) on top of the JDK image.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm

ARG CMDLINE_TOOLS_VERSION=13114758
ARG ANDROID_PLATFORM=android-36
ARG BUILD_TOOLS=36.0.0
ARG NDK_VERSION=27.1.12297006
ENV ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    GRADLE_USER_HOME=/workspace/.gradle-docker \
    PATH="/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools:${PATH}"

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl unzip git ca-certificates python3 \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL -o /tmp/cmdline-tools.zip "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS_VERSION}_latest.zip" \
 && mkdir -p ${ANDROID_HOME}/cmdline-tools \
 && unzip -q /tmp/cmdline-tools.zip -d ${ANDROID_HOME}/cmdline-tools \
 && mv ${ANDROID_HOME}/cmdline-tools/cmdline-tools ${ANDROID_HOME}/cmdline-tools/latest \
 && rm /tmp/cmdline-tools.zip \
 && yes | sdkmanager --licenses > /dev/null \
 && sdkmanager --install "platform-tools" "platforms;${ANDROID_PLATFORM}" "build-tools;${BUILD_TOOLS}" "ndk;${NDK_VERSION}" > /dev/null \
 && npm install -g pnpm@11.26.0

WORKDIR /workspace
