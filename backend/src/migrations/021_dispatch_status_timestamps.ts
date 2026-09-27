export const migration = {
  name: '021_dispatch_status_timestamps',
  sql: `
    -- Preserve operational milestones in addition to the immutable status history.
    ALTER TABLE service_requests
      ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS en_route_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS in_progress_at TIMESTAMPTZ;
  `,
};
