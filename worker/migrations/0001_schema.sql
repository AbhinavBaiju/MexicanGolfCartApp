-- Migration number: 0001 	 2026-01-15T00:00:00.000Z

-- 1. Shops
CREATE TABLE shops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_domain TEXT NOT NULL UNIQUE,
    access_token TEXT, -- Encrypted at rest (application level) if possible
    installed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    uninstalled_at DATETIME,
    timezone TEXT DEFAULT 'UTC'
);

-- 2. Locations
CREATE TABLE locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    lead_time_days INTEGER DEFAULT 1,
    min_duration_days INTEGER DEFAULT 1,
    active BOOLEAN DEFAULT 1,
    UNIQUE(shop_id, code)
);

-- 3. Products (Rentable Configuration)
CREATE TABLE products (
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL, -- Shopify Product ID (BIGINT)
    variant_id INTEGER,          -- Primary rental variant ID (optional specific)
    rentable BOOLEAN DEFAULT 0,
    default_capacity INTEGER DEFAULT 0,
    deposit_variant_id INTEGER,  -- Shopify Variant ID for deposit
    deposit_multiplier INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (shop_id, product_id)
);

-- 4. Inventory Day (Capacity & Reservations)
CREATE TABLE inventory_day (
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL,
    date TEXT NOT NULL, -- YYYY-MM-DD
    capacity INTEGER NOT NULL,
    reserved_qty INTEGER DEFAULT 0,
    PRIMARY KEY (shop_id, product_id, date)
);

-- 5. Bookings
CREATE TABLE bookings (
    id TEXT PRIMARY KEY, -- UUID
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    booking_token TEXT NOT NULL UNIQUE,
    status TEXT CHECK(status IN ('HOLD','CONFIRMED','RELEASED','EXPIRED','INVALID', 'CANCELLED')) DEFAULT 'HOLD',
    location_code TEXT NOT NULL,
    start_date TEXT NOT NULL, -- YYYY-MM-DD
    end_date TEXT NOT NULL,   -- YYYY-MM-DD
    expires_at DATETIME,      -- For HOLDs
    order_id INTEGER,         -- Shopify Order ID
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. Booking Items
CREATE TABLE booking_items (
    booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL,
    variant_id INTEGER NOT NULL,
    qty INTEGER NOT NULL,
    PRIMARY KEY (booking_id, product_id)
);

-- 7. Booking Days (Expanded allocation for easier release/auditing)
CREATE TABLE booking_days (
    booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL,
    date TEXT NOT NULL, -- YYYY-MM-DD
    qty INTEGER NOT NULL,
    PRIMARY KEY (booking_id, product_id, date)
);

-- 8. Webhook Events (Idempotency)
CREATE TABLE webhook_events (
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (shop_id, event_id)
);

-- Indexes
CREATE INDEX idx_bookings_shop_date ON bookings(shop_id, start_date);
CREATE INDEX idx_bookings_shop_status ON bookings(shop_id, status);
CREATE INDEX idx_products_rentable ON products(shop_id, rentable);
