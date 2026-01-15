-- Migration number: 0003 	 2026-01-15T15:00:00.000Z

ALTER TABLE bookings ADD COLUMN invalid_reason TEXT;
