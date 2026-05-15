const DEFAULT_BULK_API_BASE_URL = "http://127.0.0.1:8787";

export function getBulkApiBaseUrl() {
  return process.env.DASHBOARD_BULK_API_BASE_URL ?? DEFAULT_BULK_API_BASE_URL;
}

