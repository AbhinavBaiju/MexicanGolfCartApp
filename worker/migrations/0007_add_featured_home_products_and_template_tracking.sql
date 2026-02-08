-- Migration number: 0007 	 2026-02-08T00:00:00.000Z

CREATE TABLE featured_home_products (
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 3),
    product_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (shop_id, position),
    UNIQUE (shop_id, product_id)
);

CREATE INDEX idx_featured_home_products_shop_id
    ON featured_home_products(shop_id);

ALTER TABLE products ADD COLUMN previous_template_suffix TEXT;
