-- Migration number: 0006 	 2024-04-25T00:00:00.000Z

CREATE TABLE agreements (
    id TEXT PRIMARY KEY,
    shop_domain TEXT NOT NULL REFERENCES shops(shop_domain) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 0,
    title TEXT,
    pdf_storage_type TEXT NOT NULL,
    pdf_storage_key TEXT NOT NULL,
    pdf_sha256 TEXT,
    page_number INTEGER NOT NULL DEFAULT 1,
    x REAL NOT NULL DEFAULT 0,
    y REAL NOT NULL DEFAULT 0,
    width REAL NOT NULL DEFAULT 0,
    height REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    created_by TEXT
);

CREATE INDEX idx_agreements_shop_active ON agreements(shop_domain, active);
CREATE INDEX idx_agreements_shop_version ON agreements(shop_domain, version);

CREATE TABLE signed_agreements (
    id TEXT PRIMARY KEY,
    shop_domain TEXT NOT NULL REFERENCES shops(shop_domain) ON DELETE CASCADE,
    agreement_id TEXT NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
    cart_token TEXT NOT NULL,
    checkout_url TEXT,
    order_id TEXT,
    customer_email TEXT,
    signature_png_base64 TEXT NOT NULL,
    signed_pdf_storage_key TEXT,
    signed_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'linked_to_order', 'expired'))
);

CREATE INDEX idx_signed_agreements_shop_date ON signed_agreements(shop_domain, signed_at);
CREATE INDEX idx_signed_agreements_shop_status ON signed_agreements(shop_domain, status);
CREATE INDEX idx_signed_agreements_agreement_id ON signed_agreements(agreement_id);
CREATE INDEX idx_signed_agreements_order_id ON signed_agreements(order_id);
