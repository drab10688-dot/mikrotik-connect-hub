FROM ubuntu:24.04

RUN apt-get update && apt-get install -y \
    wget curl net-tools iproute2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/cms

# Create data directory
RUN mkdir -p /opt/cms/data

# Copy entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 18080

ENTRYPOINT ["/entrypoint.sh"]
