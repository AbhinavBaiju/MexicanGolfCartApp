-- Migration number: 0002 	 2026-01-15T14:30:00.000Z

-- 1. Add indexes for performance on existing tables
CREATE INDEX IF NOT EXISTS idx_bookings_shop_order_id ON bookings(shop_id, order_id);
CREATE INDEX IF NOT EXISTS idx_bookings_expires_at ON bookings(status, expires_at) WHERE status = 'HOLD';

-- 2. Recreate inventory_day to add Foreign Key referencing products
PRAGMA foreign_keys=OFF;

CREATE TABLE inventory_day_new (
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL,
    date TEXT NOT NULL, -- YYYY-MM-DD
    capacity INTEGER NOT NULL,
    reserved_qty INTEGER DEFAULT 0,
    PRIMARY KEY (shop_id, product_id, date),
    FOREIGN KEY (shop_id, product_id) REFERENCES products(shop_id, product_id) ON DELETE CASCADE
);

-- Copy data
INSERT INTO inventory_day_new (shop_id, product_id, date, capacity, reserved_qty)
SELECT shop_id, product_id, date, capacity, reserved_qty FROM inventory_day;

DROP TABLE inventory_day;

ALTER TABLE inventory_day_new RENAME TO inventory_day;

PRAGMA foreign_keys=ON;

-- 3. Add index on the new inventory_day table
CREATE INDEX IF NOT EXISTS idx_inventory_day_shop_date ON inventory_day(shop_id, date);
