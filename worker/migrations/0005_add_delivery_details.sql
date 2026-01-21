-- Migration number: 0005 	 2024-04-25T00:00:00.000Z
ALTER TABLE bookings ADD COLUMN fulfillment_type TEXT;
ALTER TABLE bookings ADD COLUMN delivery_address TEXT;
