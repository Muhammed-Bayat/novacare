export const migration = {
  name: '020_response_unit_statuses',
  sql: `
    -- Align simulated response-unit states with the dispatch workflow.
    ALTER TABLE response_units
      DROP CONSTRAINT IF EXISTS response_units_status_check;
    UPDATE response_units
      SET status = CASE status
        WHEN 'DISPATCHED' THEN 'ASSIGNED'
        WHEN 'OFF_DUTY' THEN 'OUT_OF_SERVICE'
        ELSE status
      END;
    ALTER TABLE response_units
      ADD CONSTRAINT response_units_status_check
      CHECK (status IN ('AVAILABLE', 'ASSIGNED', 'EN_ROUTE', 'OUT_OF_SERVICE'));
  `,
};
