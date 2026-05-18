CREATE TABLE IF NOT EXISTS ct_log_line_raw
(
  import_version String,
  dump_date Date,
  source_line_number UInt64,
  raw_line String,
  raw_line_sha256 FixedString(64),
  source_url String,
  source_sha256 FixedString(64),
  imported_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(dump_date)
ORDER BY (dump_date, import_version, source_line_number);

CREATE TABLE IF NOT EXISTS ct_import_attempt_events
(
  import_version String,
  dump_date Date,
  source_url String,
  source_gzip_path String,
  source_file_bytes UInt64,
  source_file_sha256 FixedString(64),
  status Enum8('importing' = 1, 'ready' = 2, 'failed' = 3),
  row_count UInt64 DEFAULT 0,
  error_message Nullable(String),
  recorded_at DateTime64(3, 'UTC')
)
ENGINE = MergeTree
ORDER BY (dump_date, import_version, recorded_at);

CREATE TABLE IF NOT EXISTS ct_domain_observation
(
  load_version String,
  dump_date Date,
  observed_domain String,
  registrable_domain String,
  first_label String,
  watch_parse_mode LowCardinality(String),
  issuer_name Nullable(String),
  not_before Nullable(DateTime64(3, 'UTC')),
  not_after Nullable(DateTime64(3, 'UTC')),
  raw_line_sha256 FixedString(64),
  loaded_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(dump_date)
ORDER BY (load_version, registrable_domain, observed_domain, raw_line_sha256);

CREATE TABLE IF NOT EXISTS ct_alert_feed
(
  load_version String,
  alert_id String,
  dump_date Date,
  domain String,
  category LowCardinality(String),
  severity LowCardinality(String),
  watch_type LowCardinality(String),
  matched_term String,
  reasons Array(String),
  issuer_name Nullable(String),
  raw_line_sha256 FixedString(64),
  created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(dump_date)
ORDER BY (load_version, dump_date, severity, domain, alert_id);

CREATE TABLE IF NOT EXISTS ct_watchlist_entry
(
  entry_id UUID,
  watch_type LowCardinality(String),
  term String,
  enabled Bool DEFAULT true,
  created_at DateTime64(3, 'UTC'),
  updated_at DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (watch_type, term, entry_id);

CREATE TABLE IF NOT EXISTS ct_runtime_state_events
(
  state_key LowCardinality(String),
  load_version String,
  dump_date Date,
  event_id UUID DEFAULT generateUUIDv7(),
  recorded_at DateTime64(3, 'UTC')
)
ENGINE = MergeTree
ORDER BY (state_key, recorded_at, event_id);

CREATE VIEW IF NOT EXISTS ct_runtime_state_current AS
SELECT
  state_key,
  argMax(load_version, tuple(recorded_at, event_id)) AS load_version,
  argMax(dump_date, tuple(recorded_at, event_id)) AS dump_date,
  max(recorded_at) AS latest_recorded_at
FROM ct_runtime_state_events
GROUP BY state_key;

CREATE VIEW IF NOT EXISTS ct_active_alert_feed AS
SELECT feed.*
FROM ct_alert_feed AS feed
INNER JOIN ct_runtime_state_current AS state
  ON state.state_key = 'ct_alert_feed'
 AND state.load_version = feed.load_version;
