#!/bin/bash
# Redis Cluster Initialization Script

set -e

echo "🔧 Initializing Redis Cluster..."
echo ""

# Wait for all Redis nodes to be ready
echo "⏳ Waiting for Redis nodes to start..."
for node in rate-limiter-redis-1 rate-limiter-redis-2 rate-limiter-redis-3 rate-limiter-redis-4 rate-limiter-redis-5 rate-limiter-redis-6; do
  while ! docker exec $node redis-cli ping > /dev/null 2>&1; do
    echo "   Waiting for $node..."
    sleep 1
  done
  echo "   ✓ $node is ready"
done

echo ""
echo "✅ All Redis nodes are ready!"
echo ""

# Create the cluster
echo "🔨 Creating Redis Cluster with 3 masters and 3 replicas..."
echo ""

docker exec rate-limiter-redis-1 redis-cli --cluster create \
  rate-limiter-redis-1:6379 \
  rate-limiter-redis-2:6379 \
  rate-limiter-redis-3:6379 \
  rate-limiter-redis-4:6379 \
  rate-limiter-redis-5:6379 \
  rate-limiter-redis-6:6379 \
  --cluster-replicas 1 \
  --cluster-yes

echo ""
echo "✅ Redis Cluster created successfully!"
echo ""

# Show cluster info
echo "📊 Cluster Information:"
echo ""
docker exec rate-limiter-redis-1 redis-cli --cluster check rate-limiter-redis-1:6379

echo ""
echo "🎉 Redis Cluster is ready to use!"
