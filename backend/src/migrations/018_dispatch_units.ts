export const migration = {
  name: '018_dispatch_units',
  sql: `
    -- Dispatch Core §13: an ambulance request can be assigned a simulated response
    -- unit (callsign) instead of an individual staff responder.
    ALTER TABLE service_requests
      ADD COLUMN assigned_unit_id UUID REFERENCES response_units(id) ON DELETE SET NULL;
  `,
};
