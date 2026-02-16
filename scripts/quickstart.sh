#!/bin/bash

# Quickstart script for Rate Limiter

set -e

echo "🚀 Rate Limiter Quickstart"
echo "=========================="
echo ""

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

echo "✅ Docker and Docker Compose are installed"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file from .env.example..."
    cp .env.example .env
    echo "✅ .env file created"
else
    echo "✅ .env file exists"
fi
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install
echo "✅ Dependencies installed"
echo ""

# Start infrastructure
echo "🐳 Starting Docker containers..."
cd infrastructure
docker-compose up -d
cd ..
echo "✅ Docker containers started"
echo ""

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 10

# Check health
echo "🏥 Checking service health..."
for i in {1..30}; do
    if curl -s http://localhost:8080/health > /dev/null 2>&1; then
        echo "✅ Rate Limiter is healthy"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ Rate Limiter failed to start"
        exit 1
    fi
    sleep 2
done
echo ""

# Seed database
echo "🌱 Seeding database with test policies..."
npm run seed
echo "✅ Database seeded"
echo ""

# Success message
echo "🎉 Quickstart complete!"
echo ""
echo "📊 Access the services:"
echo "   - Rate Limiter API: http://localhost:8080"
echo "   - Health Check:     http://localhost:8080/health"
echo "   - Metrics:          http://localhost:8080/metrics"
echo "   - Grafana:          http://localhost:3000 (admin/admin)"
echo "   - Prometheus:       http://localhost:9090"
echo ""
echo "🧪 Test the rate limiter:"
echo "   npm run test:client"
echo ""
echo "📖 Read the docs:"
echo "   - README.md"
echo "   - docs/API.md"
echo ""
echo "🛑 To stop all services:"
echo "   npm run docker:down"
