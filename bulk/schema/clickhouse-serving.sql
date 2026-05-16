CREATE TABLE IF NOT EXISTS bulk_hostname_serving
(
  load_version String,
  snapshot_month LowCardinality(String),
  ip_address String,
  hostname String,
  apex_domain String,
  tld LowCardinality(String),
  first_label String,
  cname_target Nullable(String),
  provider_hint Nullable(String),
  loaded_at DateTime64(3, 'UTC') DEFAULT now64(3),
  INDEX ip_bloom ip_address TYPE bloom_filter(0.01) GRANULARITY 4,
  INDEX apex_domain_bloom apex_domain TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY snapshot_month
ORDER BY (load_version, hostname, ip_address);

CREATE TABLE IF NOT EXISTS bulk_transform_attempt_events
(
  load_version String,
  import_version String,
  source_key String,
  snapshot_month LowCardinality(String),
  status Enum8('transforming' = 1, 'ready' = 2, 'failed' = 3),
  row_count UInt64 DEFAULT 0,
  error_message Nullable(String),
  event_id UUID DEFAULT generateUUIDv7(),
  recorded_at DateTime64(3, 'UTC')
)
ENGINE = MergeTree
ORDER BY (source_key, load_version, recorded_at, event_id);

CREATE VIEW IF NOT EXISTS bulk_transform_attempts_latest AS
SELECT
  load_version,
  source_key,
  argMax(import_version, tuple(recorded_at, event_id)) AS import_version,
  argMax(snapshot_month, tuple(recorded_at, event_id)) AS snapshot_month,
  argMax(status, tuple(recorded_at, event_id)) AS status,
  argMax(row_count, tuple(recorded_at, event_id)) AS row_count,
  argMax(error_message, tuple(recorded_at, event_id)) AS error_message,
  max(recorded_at) AS latest_recorded_at
FROM bulk_transform_attempt_events
GROUP BY load_version, source_key;

CREATE TABLE IF NOT EXISTS bulk_runtime_state_events
(
  state_key LowCardinality(String),
  load_version String,
  snapshot_month LowCardinality(String),
  event_id UUID DEFAULT generateUUIDv7(),
  recorded_at DateTime64(3, 'UTC')
)
ENGINE = MergeTree
ORDER BY (state_key, recorded_at, event_id);

CREATE VIEW IF NOT EXISTS bulk_runtime_state_current AS
SELECT
  state_key,
  argMax(load_version, tuple(recorded_at, event_id)) AS load_version,
  argMax(snapshot_month, tuple(recorded_at, event_id)) AS snapshot_month,
  max(recorded_at) AS latest_recorded_at
FROM bulk_runtime_state_events
GROUP BY state_key;

CREATE VIEW IF NOT EXISTS bulk_active_hostname_serving AS
SELECT serving.*
FROM bulk_hostname_serving AS serving
INNER JOIN bulk_runtime_state_current AS state
  ON state.state_key = 'hostname_serving'
 AND state.load_version = serving.load_version;