#!/bin/bash

# Generate continuous traffic for dashboard visualization
# This sends requests at a steady rate to populate Grafana dashboards

TENANT="${1:-abuse_test_tenant}"
DURATION="${2:-300}" # 5 minutes default
RPS="${3:-2}"        # 2 requests per second

echo "🚦 Generating traffic for $DURATION seconds at $RPS req/sec"
echo "   Tenant: $TENANT"
echo ""

START_TIME=$(date +%s)
END_TIME=$((START_TIME + DURATION))
COUNT=0

while [ $(date +%s) -lt $END_TIME ]; do
  curl -s -H "X-Tenant-ID: $TENANT" http://localhost:8080/api/search > /dev/null
  COUNT=$((COUNT + 1))

  # Progress every 10 requests
  if [ $((COUNT % 10)) -eq 0 ]; then
    ELAPSED=$(($(date +%s) - START_TIME))
    echo "  Sent $COUNT requests (${ELAPSED}s elapsed)"
  fi

  # Sleep to maintain desired RPS
  sleep $(echo "scale=3; 1/$RPS" | bc)
done

echo ""
echo "✅ Traffic generation complete"
echo "   Total requests: $COUNT"
echo "   Duration: $(($(date +%s) - START_TIME))s"
