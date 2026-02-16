# Abuse Detection and Overrides

## Goals

* Detect and mitigate abusive or pathological traffic patterns
* Apply temporary penalties without code deploy
* Keep v1 rule-based and operationally simple

## Signals (v1)

* High throttle rate for tenant over rolling window (e.g., > X% for Y minutes)
* Sudden traffic spike (RPS increase > multiplier vs baseline)

## Actions

### Override types

* **Penalty multiplier**: reduce effective `rate` and/or `cap`
* **Temporary ban**: deny all requests until expiry

### Override lifecycle

1. Detector identifies tenant
2. Create override record in MongoDB with `expiresAt`
3. Control plane publishes updates
4. SDK caches overrides and applies immediately

## Override precedence

Overrides MUST apply before standard policies.

## Safety controls

* Overrides MUST be time-bounded (expiresAt required)
* Provide manual kill switch to disable detector-driven overrides

## Observability

* Emit `ratelimit_override_applied_total{type}`
* Log structured events when overrides affect decisions

## Future extensions (non-v1)

* Streaming detector using Kafka/Redis streams
* ML anomaly scoring
* Multi-signal composite score
