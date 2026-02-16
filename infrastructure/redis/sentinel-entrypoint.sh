#!/bin/sh
set -e

echo "Waiting for Redis master to be ready..."
until nc -z redis-master 6379; do
  echo "  Redis master is unavailable - sleeping"
  sleep 1
done

echo "Redis master is up - starting Sentinel"
exec redis-sentinel /usr/local/etc/redis/sentinel.conf
