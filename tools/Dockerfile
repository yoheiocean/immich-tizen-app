# Tizen CLI (official Samsung/Tizen installer) for building + installing the Immich TV app.
# Build: bash tools/tv.sh build-image
FROM ubuntu:22.04

ARG TIZEN_VERSION=6.1
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates wget zip unzip cpio rpm2cpio pciutils python3 openjdk-11-jre-headless \
        libgtk2.0-0 libxtst6 libnss3 libasound2 \
    && rm -rf /var/lib/apt/lists/*

# The installer refuses to run as root.
RUN useradd -m -s /bin/bash tizen
USER tizen
WORKDIR /home/tizen
RUN wget -q https://download.tizen.org/sdk/Installer/tizen-studio_${TIZEN_VERSION}/web-cli_Tizen_Studio_${TIZEN_VERSION}_ubuntu-64.bin -O installer.bin \
    && chmod +x installer.bin \
    && ./installer.bin --accept-license /home/tizen/tizen-studio \
    && rm installer.bin

ENV PATH="/home/tizen/tizen-studio/tools:/home/tizen/tizen-studio/tools/ide/bin:${PATH}"
CMD ["bash"]
