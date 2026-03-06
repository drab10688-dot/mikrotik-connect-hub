FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    wget curl net-tools iproute2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/cms

# Download and install CMS C-Data
RUN wget -q https://github.com/beryindo/cms/raw/main/install.sh -O /tmp/cms-install.sh || true

# Create data directory
RUN mkdir -p /opt/cms/data

# Copy entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 18080

ENTRYPOINT ["/entrypoint.sh"]
