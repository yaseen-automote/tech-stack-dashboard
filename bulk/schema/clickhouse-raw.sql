CREATE TABLE IF NOT EXISTS bulk_hostname_raw
(
  import_version String,
  snapshot_month LowCardinality(String),
  source_row_number UInt64,
  raw_hostname Nullable(String),
  raw_ip_address Nullable(String),
  raw_cname_target Nullable(String),
  raw_provider_hint Nullable(String),
  imported_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY snapshot_month
ORDER BY (snapshot_month, import_version, source_row_number);

CREATE TABLE IF NOT EXISTS bulk_import_attempt_events
(
  import_version String,
  source_key String,
  snapshot_month LowCardinality(String),
  source_parquet_path String,
  source_file_bytes UInt64,
  source_file_sha256 FixedString(64),
  status Enum8('importing' = 1, 'ready' = 2, 'failed' = 3),
  row_count UInt64 DEFAULT 0,
  error_message Nullable(String),
  recorded_at DateTime64(3, 'UTC')
)
ENGINE = MergeTree
ORDER BY (source_key, import_version, recorded_at);
