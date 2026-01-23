var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-wLXFA7/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// src/security.ts
async function verifyHmac(params, secret) {
  const hmac = params.get("hmac");
  if (!hmac) return false;
  const tempParams = new URLSearchParams(params);
  tempParams.delete("hmac");
  tempParams.delete("signature");
  const entries = Array.from(tempParams.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const message = entries.map(([k, v]) => `${k}=${v}`).join("&");
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const signature = new Uint8Array(
    hmac.match(/[\da-f]{2}/gi).map((h) => parseInt(h, 16))
  );
  return await crypto.subtle.verify("HMAC", key, signature, messageData);
}
__name(verifyHmac, "verifyHmac");

// src/auth.ts
var jwksCache = {
  keys: /* @__PURE__ */ new Map(),
  fetchedAt: 0
};
var JWKS_CACHE_TTL_MS = 60 * 60 * 1e3;
var DEFAULT_JWKS_URL = "https://shopify.dev/.well-known/jwks.json";
async function handleAuth(request, env) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop) {
    return new Response("Missing shop parameter", { status: 400 });
  }
  const nonce = crypto.randomUUID();
  const scopes = "read_products,write_products,read_orders,write_orders";
  const redirectUri = `${env.SHOPIFY_APP_URL}/auth/callback`;
  const accessMode = "offline";
  const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${env.SHOPIFY_API_KEY}&scope=${scopes}&redirect_uri=${redirectUri}&state=${nonce}&grant_options[]=${accessMode}`;
  return Response.redirect(authUrl);
}
__name(handleAuth, "handleAuth");
async function verifySessionToken(token, secret, apiKey, jwksUrl) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeBase64UrlJson(encodedHeader);
  const payload = decodeBase64UrlJson(encodedPayload);
  if (!header || !payload) {
    return null;
  }
  const nowSeconds = Math.floor(Date.now() / 1e3);
  if (!Number.isFinite(payload.exp) || payload.exp <= nowSeconds) {
    return null;
  }
  if (payload.nbf && payload.nbf > nowSeconds) {
    return null;
  }
  if (!isAudienceMatch(payload.aud, apiKey)) {
    return null;
  }
  const destHost = safeUrlHost(payload.dest);
  const issHost = safeUrlHost(payload.iss);
  if (!destHost || !issHost || destHost !== issHost) {
    return null;
  }
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = base64UrlToUint8Array(encodedSignature);
  const data = new TextEncoder().encode(signingInput);
  if (header.alg === "RS256") {
    const jwk = await getShopifyJwk(header.kid, jwksUrl);
    if (!jwk) {
      return null;
    }
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const verified = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, data);
    return verified ? payload : null;
  }
  if (header.alg === "HS256") {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const verified = await crypto.subtle.verify("HMAC", key, signature, data);
    return verified ? payload : null;
  }
  return null;
}
__name(verifySessionToken, "verifySessionToken");
async function handleAuthCallback(request, env) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const code = url.searchParams.get("code");
  const hmac = url.searchParams.get("hmac");
  if (!shop || !code || !hmac) {
    return new Response("Missing required parameters", { status: 400 });
  }
  const valid = await verifyHmac(url.searchParams, env.SHOPIFY_API_SECRET);
  if (!valid) {
    return new Response("HMAC validation failed", { status: 400 });
  }
  const accessToken = await exchangeAccessToken(shop, code, env);
  if (!accessToken) {
    return new Response("Failed to exchange access token", { status: 500 });
  }
  try {
    await env.DB.prepare(
      `INSERT INTO shops (shop_domain, access_token, installed_at) 
       VALUES (?, ?, datetime('now')) 
       ON CONFLICT(shop_domain) DO UPDATE SET 
       access_token = excluded.access_token, 
       uninstalled_at = NULL,
       installed_at = datetime('now')`
    ).bind(shop, accessToken).run();
  } catch (e) {
    console.error("Database error:", e);
    return new Response("Failed to store shop data", { status: 500 });
  }
  await registerWebhook(shop, accessToken, env);
  const host = url.searchParams.get("host");
  if (host) {
    return new Response(`App installed successfully for ${shop}! You can close this window.`);
  }
  return new Response(`App installed successfully for ${shop}!`);
}
__name(handleAuthCallback, "handleAuthCallback");
async function exchangeAccessToken(shop, code, env) {
  const body = {
    client_id: env.SHOPIFY_API_KEY,
    client_secret: env.SHOPIFY_API_SECRET,
    code
  };
  try {
    const resp = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      const txt = await resp.text();
      console.error("Token exchange failed", resp.status, txt);
      return null;
    }
    const data = await resp.json();
    return data.access_token;
  } catch (e) {
    console.error("Token exchange error", e);
    return null;
  }
}
__name(exchangeAccessToken, "exchangeAccessToken");
async function registerWebhook(shop, accessToken, env) {
  const webhooks = [
    {
      topic: "orders/create",
      address: `${env.SHOPIFY_APP_URL}/webhooks/orders/create`,
      format: "json"
    },
    {
      topic: "app/uninstalled",
      address: `${env.SHOPIFY_APP_URL}/webhooks/app/uninstalled`,
      format: "json"
    }
  ];
  const apiVersion = "2026-04";
  for (const hook of webhooks) {
    try {
      const resp = await fetch(`https://${shop}/admin/api/${apiVersion}/webhooks.json`, {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ webhook: hook })
      });
      if (!resp.ok) {
        const txt = await resp.text();
        console.log(`Webhook ${hook.topic} registration result:`, resp.status, txt);
      } else {
        console.log(`Webhook ${hook.topic} registered successfully`);
      }
    } catch (e) {
      console.error(`Webhook ${hook.topic} registration failed`, e);
    }
  }
}
__name(registerWebhook, "registerWebhook");
function decodeBase64UrlJson(input) {
  try {
    const json = new TextDecoder().decode(base64UrlToUint8Array(input));
    return JSON.parse(json);
  } catch {
    return null;
  }
}
__name(decodeBase64UrlJson, "decodeBase64UrlJson");
function base64UrlToUint8Array(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - normalized.length % 4);
  const base64 = normalized + padding;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
__name(base64UrlToUint8Array, "base64UrlToUint8Array");
function isAudienceMatch(aud, apiKey) {
  if (typeof aud === "string") {
    return aud === apiKey;
  }
  if (Array.isArray(aud)) {
    return aud.includes(apiKey);
  }
  return false;
}
__name(isAudienceMatch, "isAudienceMatch");
function safeUrlHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}
__name(safeUrlHost, "safeUrlHost");
async function getShopifyJwk(kid, jwksUrl) {
  const url = jwksUrl || DEFAULT_JWKS_URL;
  const now = Date.now();
  if (jwksCache.keys.size === 0 || now - jwksCache.fetchedAt > JWKS_CACHE_TTL_MS) {
    const resp = await fetch(url);
    if (!resp.ok) {
      return null;
    }
    const data = await resp.json();
    const map = /* @__PURE__ */ new Map();
    for (const key of data.keys) {
      if (key.kid) {
        map.set(key.kid, key);
      }
    }
    jwksCache.keys = map;
    jwksCache.fetchedAt = now;
  }
  if (kid) {
    return jwksCache.keys.get(kid) || null;
  }
  const first = jwksCache.keys.values().next();
  return first.done ? null : first.value;
}
__name(getShopifyJwk, "getShopifyJwk");

// src/date.ts
var ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function parseDateParts(value) {
  if (!ISO_DATE_RE.test(value)) {
    return null;
  }
  const [yearStr, monthStr, dayStr] = value.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}
__name(parseDateParts, "parseDateParts");
function datePartsToIndex(parts) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 864e5);
}
__name(datePartsToIndex, "datePartsToIndex");
function dateIndexToString(dayIndex) {
  return new Date(dayIndex * 864e5).toISOString().slice(0, 10);
}
__name(dateIndexToString, "dateIndexToString");
function getTodayInTimeZone(timeZone, now = /* @__PURE__ */ new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(now);
}
__name(getTodayInTimeZone, "getTodayInTimeZone");
function listDateStrings(startDate, endDate) {
  const startParts = parseDateParts(startDate);
  const endParts = parseDateParts(endDate);
  if (!startParts || !endParts) {
    return null;
  }
  const startIndex = datePartsToIndex(startParts);
  const endIndex = datePartsToIndex(endParts);
  if (startIndex > endIndex) {
    return null;
  }
  const dates = [];
  for (let i = startIndex; i <= endIndex; i += 1) {
    dates.push(dateIndexToString(i));
  }
  return dates;
}
__name(listDateStrings, "listDateStrings");

// src/config.ts
var STORE_TIMEZONE = "America/Mexico_City";

// src/bookingService.ts
async function confirmBookingsFromOrder(env, shopDomain, eventId, topic, rawBody) {
  const db = env.DB;
  let shopId = null;
  let insertedEvent = false;
  try {
    const shopRow = await db.prepare("SELECT id FROM shops WHERE shop_domain = ?").bind(shopDomain).first();
    const parsedShopId = isRecord(shopRow) ? toPositiveInt(shopRow.id) : null;
    if (!parsedShopId) {
      console.error("Shop not found for webhook", shopDomain);
      return { status: 200, body: "Shop not found" };
    }
    shopId = parsedShopId;
    const existingEvent = await db.prepare("SELECT event_id FROM webhook_events WHERE shop_id = ? AND event_id = ?").bind(shopId, eventId).first();
    if (existingEvent) {
      return { status: 200, body: "Duplicate webhook event" };
    }
    try {
      await db.prepare("INSERT INTO webhook_events (shop_id, event_id, topic) VALUES (?, ?, ?)").bind(shopId, eventId, topic).run();
      insertedEvent = true;
    } catch (e) {
      const message = String(e);
      if (message.includes("UNIQUE") || message.includes("constraint")) {
        return { status: 200, body: "Duplicate webhook event" };
      }
      console.error("Failed to record webhook event", e);
      return { status: 500, body: "Failed to record webhook event" };
    }
    const order = parseOrderPayload(rawBody);
    if (!order) {
      console.error("Invalid order payload");
      return { status: 200, body: "Invalid order payload" };
    }
    const extraction = extractBookingTokens(order.line_items);
    if (extraction.tokens.length === 0) {
      return { status: 200, body: "No booking tokens found" };
    }
    let confirmedCount = 0;
    let invalidCount = 0;
    let cancellationTriggered = false;
    let cancellationResult = null;
    const customerName = [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(" ") || "Guest";
    const customerEmail = order.customer?.email || order.email || "";
    for (const token of extraction.tokens) {
      const lineItems = extraction.lineItemsByToken.get(token) ?? [];
      const revenue = calculateBookingRevenue(lineItems);
      const result = await processBookingToken(db, shopId, order.id, token, lineItems, customerName, customerEmail, revenue);
      if (result.status === "confirmed") {
        confirmedCount += 1;
      } else {
        invalidCount += 1;
        console.warn("Booking validation failed", { token, reason: result.reason });
        if (!cancellationTriggered && shopId) {
          cancellationTriggered = true;
          cancellationResult = await cancelShopifyOrder(env, shopId, order.id, result.reason);
        }
        if (cancellationResult && !cancellationResult.succeeded && result.bookingId) {
          await markBookingManualReview(db, result.bookingId, "Manual cancellation required");
        }
      }
    }
    const summary = `Processed ${extraction.tokens.length} booking token(s). Confirmed: ${confirmedCount}. Invalid: ${invalidCount}.`;
    return { status: 200, body: summary };
  } catch (e) {
    console.error("Order webhook processing error", e);
    if (insertedEvent && shopId) {
      await deleteWebhookEvent(db, shopId, eventId);
    }
    return { status: 500, body: "Internal Server Error" };
  }
}
__name(confirmBookingsFromOrder, "confirmBookingsFromOrder");
async function releaseBooking(db, bookingId, targetStatus) {
  const booking = await db.prepare("SELECT shop_id, status FROM bookings WHERE id = ?").bind(bookingId).first();
  if (!booking) {
    throw new Error(`Booking not found: ${bookingId}`);
  }
  if (booking.status !== "HOLD") {
    return;
  }
  const bookingDays = await db.prepare("SELECT product_id, date, qty FROM booking_days WHERE booking_id = ?").bind(bookingId).all();
  const statements = [];
  statements.push(
    db.prepare(
      `UPDATE bookings
             SET status = ?, updated_at = datetime('now')
             WHERE id = ? AND status = 'HOLD'`
    ).bind(targetStatus, bookingId)
  );
  statements.push(db.prepare("SELECT CASE WHEN changes() = 1 THEN 1 ELSE 1/0 END;"));
  for (const row of bookingDays.results ?? []) {
    const bookingDay = row;
    const productId = bookingDay.product_id;
    const date = bookingDay.date;
    const qty = bookingDay.qty;
    statements.push(
      db.prepare(
        `UPDATE inventory_day
                 SET reserved_qty = reserved_qty - ?
                 WHERE shop_id = ? AND product_id = ? AND date = ? AND reserved_qty >= ?`
      ).bind(qty, booking.shop_id, productId, date, qty)
    );
    statements.push(db.prepare("SELECT CASE WHEN changes() = 1 THEN 1 ELSE 1/0 END;"));
  }
  await db.batch(statements);
}
__name(releaseBooking, "releaseBooking");
async function processBookingToken(db, shopId, orderId, bookingToken, lineItems, customerName, customerEmail, revenue) {
  const bookingRow = await db.prepare("SELECT id, shop_id, status, order_id, start_date, end_date, location_code FROM bookings WHERE booking_token = ?").bind(bookingToken).first();
  const booking = parseBookingDetailRow(bookingRow);
  if (!booking) {
    return { status: "invalid", reason: "Booking not found", bookingId: null };
  }
  if (booking.shop_id !== shopId) {
    await markBookingInvalid(db, booking.id, "Booking shop mismatch");
    return { status: "invalid", reason: "Booking shop mismatch", bookingId: booking.id };
  }
  if (booking.status === "CONFIRMED" && booking.order_id === orderId) {
    return { status: "confirmed", reason: "Already confirmed", bookingId: booking.id };
  }
  if (booking.status !== "HOLD") {
    await markBookingInvalid(db, booking.id, `Booking status ${booking.status}`);
    return { status: "invalid", reason: `Booking status ${booking.status}`, bookingId: booking.id };
  }
  if (lineItems.length === 0) {
    await markBookingInvalid(db, booking.id, "Missing order line items for booking token");
    return { status: "invalid", reason: "Missing order line items", bookingId: booking.id };
  }
  const lineItemMeta = extractBookingMetaFromLineItems(lineItems);
  if (lineItemMeta.error) {
    await markBookingInvalid(db, booking.id, lineItemMeta.error);
    return { status: "invalid", reason: lineItemMeta.error, bookingId: booking.id };
  }
  if (!lineItemMeta.startDate) {
    await markBookingInvalid(db, booking.id, "Missing booking start date");
    return { status: "invalid", reason: "Missing booking start date", bookingId: booking.id };
  }
  if (!lineItemMeta.endDate) {
    await markBookingInvalid(db, booking.id, "Missing booking end date");
    return { status: "invalid", reason: "Missing booking end date", bookingId: booking.id };
  }
  if (!lineItemMeta.location) {
    await markBookingInvalid(db, booking.id, "Missing booking location");
    return { status: "invalid", reason: "Missing booking location", bookingId: booking.id };
  }
  if (lineItemMeta.startDate !== booking.start_date || lineItemMeta.endDate !== booking.end_date) {
    await markBookingInvalid(db, booking.id, "Date tampering detected");
    return { status: "invalid", reason: "Date tampering detected", bookingId: booking.id };
  }
  if (lineItemMeta.location !== booking.location_code) {
    await markBookingInvalid(db, booking.id, "Location tampering detected");
    return { status: "invalid", reason: "Location tampering detected", bookingId: booking.id };
  }
  const dateRuleError = await validateBookingDateRules(
    db,
    shopId,
    booking.location_code,
    booking.start_date,
    booking.end_date
  );
  if (dateRuleError) {
    await markBookingInvalid(db, booking.id, dateRuleError);
    return { status: "invalid", reason: dateRuleError, bookingId: booking.id };
  }
  const bookingItemsResult = await db.prepare("SELECT product_id, variant_id, qty FROM booking_items WHERE booking_id = ?").bind(booking.id).all();
  const bookingItems = normalizeBookingItems(bookingItemsResult.results ?? []);
  if (bookingItems.length === 0) {
    await markBookingInvalid(db, booking.id, "Booking items missing");
    return { status: "invalid", reason: "Booking items missing", bookingId: booking.id };
  }
  const uniqueProductIds = Array.from(new Set(bookingItems.map((item) => item.product_id)));
  const productMap = await fetchProductDeposits(db, shopId, uniqueProductIds);
  if (!productMap || productMap.size !== uniqueProductIds.length) {
    await markBookingInvalid(db, booking.id, "Product configuration missing");
    return { status: "invalid", reason: "Product configuration missing", bookingId: booking.id };
  }
  const lineItemKeyQty = buildLineItemKeyMap(lineItems);
  const lineItemVariantQty = buildLineItemVariantMap(lineItems);
  const inventoryMismatch = validateBookingItemsMatch(bookingItems, lineItemKeyQty);
  if (inventoryMismatch) {
    await markBookingInvalid(db, booking.id, inventoryMismatch);
    return { status: "invalid", reason: inventoryMismatch, bookingId: booking.id };
  }
  const depositMismatch = validateDepositLineItems(bookingItems, productMap, lineItemVariantQty);
  if (depositMismatch) {
    await markBookingInvalid(db, booking.id, depositMismatch);
    return { status: "invalid", reason: depositMismatch, bookingId: booking.id };
  }
  const bookingDaysResult = await db.prepare("SELECT COUNT(*) as count FROM booking_days WHERE booking_id = ?").bind(booking.id).first();
  const bookingDaysCount = bookingDaysResult && typeof bookingDaysResult.count === "number" ? bookingDaysResult.count : 0;
  if (bookingDaysCount === 0) {
    await markBookingInvalid(db, booking.id, "Capacity allocations missing");
    return { status: "invalid", reason: "Capacity allocations missing", bookingId: booking.id };
  }
  const confirmed = await markBookingConfirmed(
    db,
    booking.id,
    orderId,
    customerName,
    customerEmail,
    revenue,
    lineItemMeta.fulfillmentType || null,
    lineItemMeta.deliveryAddress || null
  );
  if (!confirmed) {
    const refreshed = await db.prepare("SELECT status, order_id FROM bookings WHERE id = ?").bind(booking.id).first();
    const refreshedStatus = parseBookingStatusRow(refreshed);
    if (refreshedStatus && refreshedStatus.status === "CONFIRMED" && refreshedStatus.order_id === orderId) {
      return { status: "confirmed", reason: "Already confirmed", bookingId: booking.id };
    }
    await markBookingInvalid(db, booking.id, "Failed to confirm booking");
    return { status: "invalid", reason: "Failed to confirm booking", bookingId: booking.id };
  }
  return { status: "confirmed", reason: "Confirmed", bookingId: booking.id };
}
__name(processBookingToken, "processBookingToken");
async function markBookingConfirmed(db, bookingId, orderId, customerName, customerEmail, revenue, fulfillmentType, deliveryAddress) {
  const result = await db.prepare(
    `UPDATE bookings
             SET status = 'CONFIRMED', order_id = ?, customer_name = ?, customer_email = ?, revenue = ?, fulfillment_type = ?, delivery_address = ?, updated_at = datetime('now')
             WHERE id = ? AND status = 'HOLD'`
  ).bind(orderId, customerName, customerEmail, revenue, fulfillmentType, deliveryAddress, bookingId).run();
  return (result.meta?.changes ?? 0) > 0;
}
__name(markBookingConfirmed, "markBookingConfirmed");
async function markBookingInvalid(db, bookingId, reason) {
  try {
    await db.prepare(
      `UPDATE bookings
                 SET status = 'INVALID', invalid_reason = ?, updated_at = datetime('now')
                 WHERE id = ?`
    ).bind(reason, bookingId).run();
  } catch (e) {
    const message = String(e);
    if (message.includes("no such column: invalid_reason")) {
      await db.prepare(
        `UPDATE bookings
                     SET status = 'INVALID', updated_at = datetime('now')
                     WHERE id = ?`
      ).bind(bookingId).run();
      return;
    }
    throw e;
  }
}
__name(markBookingInvalid, "markBookingInvalid");
async function markBookingManualReview(db, bookingId, note) {
  try {
    await db.prepare(
      `UPDATE bookings
                 SET invalid_reason = CASE
                     WHEN invalid_reason IS NULL OR invalid_reason = '' THEN ?
                     WHEN instr(invalid_reason, ?) > 0 THEN invalid_reason
                     ELSE invalid_reason || ' | ' || ?
                 END,
                 updated_at = datetime('now')
                 WHERE id = ?`
    ).bind(note, note, note, bookingId).run();
  } catch (e) {
    const message = String(e);
    if (message.includes("no such column: invalid_reason")) {
      return;
    }
    throw e;
  }
}
__name(markBookingManualReview, "markBookingManualReview");
async function cancelShopifyOrder(env, shopId, orderId, reason) {
  try {
    const shopRow = await env.DB.prepare("SELECT shop_domain, access_token FROM shops WHERE id = ?").bind(shopId).first();
    if (!shopRow) {
      console.error("Shop not found for order cancellation", { shopId, orderId, reason });
      return { attempted: false, succeeded: false };
    }
    const shopAuth = parseShopAuthRow(shopRow);
    if (!shopAuth) {
      console.error("Shop credentials missing for order cancellation", { shopId, orderId, reason });
      return { attempted: false, succeeded: false };
    }
    const response = await fetch(
      `https://${shopAuth.shop_domain}/admin/api/2024-04/orders/${orderId}/cancel.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": shopAuth.access_token
        },
        body: JSON.stringify({ email: true })
      }
    );
    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Failed to cancel Shopify order", {
        shopId,
        orderId,
        status: response.status,
        reason,
        errorBody
      });
      return { attempted: true, succeeded: false };
    }
    return { attempted: true, succeeded: true };
  } catch (e) {
    console.error("Error cancelling Shopify order", { shopId, orderId, reason, error: e });
    return { attempted: false, succeeded: false };
  }
}
__name(cancelShopifyOrder, "cancelShopifyOrder");
async function fetchProductDeposits(db, shopId, productIds) {
  if (productIds.length === 0) {
    return /* @__PURE__ */ new Map();
  }
  const placeholders = productIds.map(() => "?").join(", ");
  const result = await db.prepare(
    `SELECT product_id, deposit_variant_id, deposit_multiplier
             FROM products
             WHERE shop_id = ? AND product_id IN (${placeholders})`
  ).bind(shopId, ...productIds).all();
  const rows = normalizeProductDeposits(result.results ?? []);
  const map = /* @__PURE__ */ new Map();
  for (const row of rows) {
    map.set(row.product_id, row);
  }
  return map;
}
__name(fetchProductDeposits, "fetchProductDeposits");
async function validateBookingDateRules(db, shopId, locationCode, startDate, endDate) {
  const startParts = parseDateParts(startDate);
  const endParts = parseDateParts(endDate);
  if (!startParts || !endParts) {
    return "Invalid booking dates";
  }
  const startIndex = datePartsToIndex(startParts);
  const endIndex = datePartsToIndex(endParts);
  if (startIndex > endIndex) {
    return "Invalid booking date range";
  }
  const rules = await fetchLocationRules(db, shopId, locationCode);
  if (!rules) {
    return "Location rules missing";
  }
  const todayStr = getTodayInTimeZone(STORE_TIMEZONE);
  const todayParts = parseDateParts(todayStr);
  if (!todayParts) {
    return "Failed to read store date";
  }
  const todayIndex = datePartsToIndex(todayParts);
  const durationDays = endIndex - startIndex + 1;
  if (startIndex < todayIndex + rules.leadTimeDays) {
    return "Start date violates lead time";
  }
  if (durationDays < rules.minDurationDays) {
    return "Below minimum duration";
  }
  return null;
}
__name(validateBookingDateRules, "validateBookingDateRules");
async function fetchLocationRules(db, shopId, locationCode) {
  const row = await db.prepare(
    "SELECT lead_time_days, min_duration_days FROM locations WHERE shop_id = ? AND code = ? AND active = 1"
  ).bind(shopId, locationCode).first();
  if (!isRecord(row)) {
    return null;
  }
  const leadTimeDays = toNonNegativeInt(row.lead_time_days);
  const minDurationDays = toPositiveInt(row.min_duration_days);
  if (leadTimeDays === null || minDurationDays === null) {
    return null;
  }
  return { leadTimeDays, minDurationDays };
}
__name(fetchLocationRules, "fetchLocationRules");
function validateBookingItemsMatch(bookingItems, lineItemKeyQty) {
  for (const item of bookingItems) {
    const key = buildLineItemKey(item.product_id, item.variant_id);
    const qty = lineItemKeyQty.get(key);
    if (!qty) {
      return `Missing line item for product ${item.product_id}`;
    }
    if (qty !== item.qty) {
      return `Quantity mismatch for product ${item.product_id}`;
    }
  }
  return null;
}
__name(validateBookingItemsMatch, "validateBookingItemsMatch");
function validateDepositLineItems(bookingItems, productMap, lineItemVariantQty) {
  const expectedByVariant = /* @__PURE__ */ new Map();
  for (const item of bookingItems) {
    const product = productMap.get(item.product_id);
    if (!product) {
      return `Product configuration missing for ${item.product_id}`;
    }
    if (!product.deposit_variant_id) {
      continue;
    }
    const multiplier = normalizeDepositMultiplier(product.deposit_multiplier);
    const expectedQty = item.qty * multiplier;
    const current = expectedByVariant.get(product.deposit_variant_id) ?? 0;
    expectedByVariant.set(product.deposit_variant_id, current + expectedQty);
  }
  for (const [variantId, expectedQty] of expectedByVariant.entries()) {
    const actualQty = lineItemVariantQty.get(variantId) ?? 0;
    if (actualQty !== expectedQty) {
      return `Missing or mismatched deposit line item ${variantId}`;
    }
  }
  return null;
}
__name(validateDepositLineItems, "validateDepositLineItems");
function normalizeDepositMultiplier(value) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  return 1;
}
__name(normalizeDepositMultiplier, "normalizeDepositMultiplier");
function buildLineItemKeyMap(lineItems) {
  const map = /* @__PURE__ */ new Map();
  for (const item of lineItems) {
    if (!item.product_id || !item.variant_id) {
      continue;
    }
    const key = buildLineItemKey(item.product_id, item.variant_id);
    const qty = Number.isInteger(item.quantity) && item.quantity > 0 ? item.quantity : 0;
    map.set(key, (map.get(key) ?? 0) + qty);
  }
  return map;
}
__name(buildLineItemKeyMap, "buildLineItemKeyMap");
function buildLineItemVariantMap(lineItems) {
  const map = /* @__PURE__ */ new Map();
  for (const item of lineItems) {
    if (!item.variant_id) {
      continue;
    }
    const qty = Number.isInteger(item.quantity) && item.quantity > 0 ? item.quantity : 0;
    map.set(item.variant_id, (map.get(item.variant_id) ?? 0) + qty);
  }
  return map;
}
__name(buildLineItemVariantMap, "buildLineItemVariantMap");
function buildLineItemKey(productId, variantId) {
  return `${productId}:${variantId}`;
}
__name(buildLineItemKey, "buildLineItemKey");
function parseOrderPayload(rawBody) {
  let data;
  try {
    data = JSON.parse(rawBody);
  } catch (e) {
    console.error("Failed to parse order payload JSON", e);
    return null;
  }
  if (!isRecord(data)) {
    return null;
  }
  const orderId = toPositiveInt(data.id);
  if (!orderId) {
    return null;
  }
  const lineItemsValue = data.line_items;
  if (!Array.isArray(lineItemsValue)) {
    return null;
  }
  const lineItems = [];
  for (const value of lineItemsValue) {
    const parsed = parseLineItem(value);
    if (parsed) {
      lineItems.push(parsed);
    }
  }
  const email = readString(data.email);
  const customer = isRecord(data.customer) ? {
    first_name: readString(data.customer.first_name) || void 0,
    last_name: readString(data.customer.last_name) || void 0,
    email: readString(data.customer.email) || void 0
  } : null;
  const current_subtotal_price = readStringOrNumber(data.current_subtotal_price);
  return { id: orderId, line_items: lineItems, email, customer, current_subtotal_price };
}
__name(parseOrderPayload, "parseOrderPayload");
function parseLineItem(value) {
  if (!isRecord(value)) {
    return null;
  }
  const productId = toPositiveInt(value.product_id);
  const variantId = toPositiveInt(value.variant_id);
  const quantity = toPositiveInt(value.quantity) ?? 0;
  const price = readStringOrNumber(value.price);
  let properties = null;
  if (Array.isArray(value.properties)) {
    properties = value.properties;
  } else if (isRecord(value.properties)) {
    properties = value.properties;
  }
  return {
    product_id: productId,
    variant_id: variantId,
    quantity,
    price,
    properties
  };
}
__name(parseLineItem, "parseLineItem");
function extractBookingTokens(lineItems) {
  const tokens = /* @__PURE__ */ new Set();
  const lineItemsByToken = /* @__PURE__ */ new Map();
  for (const item of lineItems) {
    const token = extractBookingToken(item.properties);
    if (!token) {
      continue;
    }
    tokens.add(token);
    const existing = lineItemsByToken.get(token);
    if (existing) {
      existing.push(item);
    } else {
      lineItemsByToken.set(token, [item]);
    }
  }
  return { tokens: Array.from(tokens), lineItemsByToken };
}
__name(extractBookingTokens, "extractBookingTokens");
function extractBookingToken(properties) {
  if (!properties) {
    return null;
  }
  if (Array.isArray(properties)) {
    for (const prop of properties) {
      if (!isRecord(prop)) {
        continue;
      }
      const name = readString(prop.name);
      const value = readStringOrNumber(prop.value);
      if (!name || !value) {
        continue;
      }
      if (isBookingTokenProperty(name)) {
        return value;
      }
    }
    return null;
  }
  if (isRecord(properties)) {
    for (const [key, value] of Object.entries(properties)) {
      const name = readString(key);
      const tokenValue = readStringOrNumber(value);
      if (!name || !tokenValue) {
        continue;
      }
      if (isBookingTokenProperty(name)) {
        return tokenValue;
      }
    }
  }
  return null;
}
__name(extractBookingToken, "extractBookingToken");
function isBookingTokenProperty(name) {
  return normalizePropertyName(name) === "booking_token";
}
__name(isBookingTokenProperty, "isBookingTokenProperty");
var START_DATE_PROPERTY_KEYS = /* @__PURE__ */ new Set(["start_date", "booking_start_date"]);
var END_DATE_PROPERTY_KEYS = /* @__PURE__ */ new Set(["end_date", "booking_end_date"]);
var LOCATION_PROPERTY_KEYS = /* @__PURE__ */ new Set(["location", "booking_location"]);
var FULFILLMENT_TYPE_KEYS = /* @__PURE__ */ new Set(["fulfillment_type", "fulfillment type"]);
var DELIVERY_ADDRESS_KEYS = /* @__PURE__ */ new Set(["delivery_address", "delivery address"]);
function extractBookingMetaFromLineItems(lineItems) {
  let startDate = null;
  let endDate = null;
  let location = null;
  let fulfillmentType = null;
  let deliveryAddress = null;
  for (const item of lineItems) {
    const meta = extractBookingMetaFromProperties(item.properties);
    if (meta.error) {
      return meta;
    }
    if (meta.startDate) {
      if (startDate && startDate !== meta.startDate) {
        return {
          startDate,
          endDate,
          location,
          error: "Inconsistent booking start date across line items"
        };
      }
      startDate = meta.startDate;
    }
    if (meta.endDate) {
      if (endDate && endDate !== meta.endDate) {
        return {
          startDate,
          endDate,
          location,
          error: "Inconsistent booking end date across line items"
        };
      }
      endDate = meta.endDate;
    }
    if (meta.location) {
      if (location && location !== meta.location) {
        return {
          startDate,
          endDate,
          location,
          error: "Inconsistent booking location across line items"
        };
      }
      location = meta.location;
    }
    if (meta.fulfillmentType) {
      if (fulfillmentType && fulfillmentType !== meta.fulfillmentType) {
      }
      fulfillmentType = meta.fulfillmentType;
    }
    if (meta.deliveryAddress) {
      deliveryAddress = meta.deliveryAddress;
    }
  }
  return { startDate, endDate, location, fulfillmentType, deliveryAddress };
}
__name(extractBookingMetaFromLineItems, "extractBookingMetaFromLineItems");
function extractBookingMetaFromProperties(properties) {
  let startDate = null;
  let endDate = null;
  let location = null;
  let fulfillmentType = null;
  let deliveryAddress = null;
  if (!properties) {
    return { startDate, endDate, location };
  }
  const applyValue = /* @__PURE__ */ __name((name, value) => {
    const normalized = normalizePropertyName(name);
    if (START_DATE_PROPERTY_KEYS.has(normalized)) {
      if (startDate && startDate !== value) {
        return "Conflicting booking start date in line item properties";
      }
      startDate = value;
    } else if (END_DATE_PROPERTY_KEYS.has(normalized)) {
      if (endDate && endDate !== value) {
        return "Conflicting booking end date in line item properties";
      }
      endDate = value;
    } else if (LOCATION_PROPERTY_KEYS.has(normalized)) {
      if (location && location !== value) {
        return "Conflicting booking location in line item properties";
      }
      location = value;
    } else if (FULFILLMENT_TYPE_KEYS.has(normalized)) {
      fulfillmentType = value;
    } else if (DELIVERY_ADDRESS_KEYS.has(normalized)) {
      deliveryAddress = value;
    }
    return null;
  }, "applyValue");
  if (Array.isArray(properties)) {
    for (const prop of properties) {
      if (!isRecord(prop)) {
        continue;
      }
      const name = readString(prop.name);
      const value = readStringOrNumber(prop.value);
      if (!name || !value) {
        continue;
      }
      const error = applyValue(name, value);
      if (error) {
        return { startDate, endDate, location, error };
      }
    }
    return { startDate, endDate, location };
  }
  if (isRecord(properties)) {
    for (const [key, rawValue] of Object.entries(properties)) {
      const name = readString(key);
      const value = readStringOrNumber(rawValue);
      if (!name || !value) {
        continue;
      }
      const error = applyValue(name, value);
      if (error) {
        return { startDate, endDate, location, error };
      }
    }
  }
  return { startDate, endDate, location, fulfillmentType, deliveryAddress };
}
__name(extractBookingMetaFromProperties, "extractBookingMetaFromProperties");
function normalizePropertyName(name) {
  return name.trim().toLowerCase().replace(/\s+/g, "_").replace(/^_+/, "");
}
__name(normalizePropertyName, "normalizePropertyName");
function parseBookingDetailRow(row) {
  if (!isRecord(row)) {
    return null;
  }
  const id = readString(row.id);
  const shopId = toPositiveInt(row.shop_id);
  const status = readBookingStatus(row.status);
  const orderId = toPositiveInt(row.order_id);
  const startDate = readString(row.start_date);
  const endDate = readString(row.end_date);
  const locationCode = readString(row.location_code);
  if (!id || !shopId || !status || !startDate || !endDate || !locationCode) {
    return null;
  }
  return {
    id,
    shop_id: shopId,
    status,
    order_id: orderId ?? null,
    start_date: startDate,
    end_date: endDate,
    location_code: locationCode
  };
}
__name(parseBookingDetailRow, "parseBookingDetailRow");
function parseShopAuthRow(row) {
  if (!isRecord(row)) {
    return null;
  }
  const shopDomain = readString(row.shop_domain);
  const accessToken = readString(row.access_token);
  if (!shopDomain || !accessToken) {
    return null;
  }
  return { shop_domain: shopDomain, access_token: accessToken };
}
__name(parseShopAuthRow, "parseShopAuthRow");
function parseBookingStatusRow(row) {
  if (!isRecord(row)) {
    return null;
  }
  const status = readBookingStatus(row.status);
  if (!status) {
    return null;
  }
  const orderId = toPositiveInt(row.order_id);
  return { status, order_id: orderId ?? null };
}
__name(parseBookingStatusRow, "parseBookingStatusRow");
function normalizeBookingItems(rows) {
  const items = [];
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const productId = toPositiveInt(row.product_id);
    const variantId = toPositiveInt(row.variant_id);
    const qty = toPositiveInt(row.qty);
    if (!productId || !variantId || !qty) {
      continue;
    }
    items.push({ product_id: productId, variant_id: variantId, qty });
  }
  return items;
}
__name(normalizeBookingItems, "normalizeBookingItems");
function normalizeProductDeposits(rows) {
  const items = [];
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const productId = toPositiveInt(row.product_id);
    if (!productId) {
      continue;
    }
    const depositVariantId = toPositiveInt(row.deposit_variant_id);
    const multiplier = toPositiveInt(row.deposit_multiplier);
    items.push({
      product_id: productId,
      deposit_variant_id: depositVariantId ?? null,
      deposit_multiplier: multiplier ?? null
    });
  }
  return items;
}
__name(normalizeProductDeposits, "normalizeProductDeposits");
async function deleteWebhookEvent(db, shopId, eventId) {
  try {
    await db.prepare("DELETE FROM webhook_events WHERE shop_id = ? AND event_id = ?").bind(shopId, eventId).run();
  } catch (e) {
    console.error("Failed to cleanup webhook event", e);
  }
}
__name(deleteWebhookEvent, "deleteWebhookEvent");
function readString(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return null;
}
__name(readString, "readString");
function readStringOrNumber(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}
__name(readStringOrNumber, "readStringOrNumber");
function readBookingStatus(value) {
  if (typeof value !== "string") {
    return null;
  }
  switch (value) {
    case "HOLD":
    case "CONFIRMED":
    case "RELEASED":
    case "EXPIRED":
    case "INVALID":
    case "CANCELLED":
      return value;
    default:
      return null;
  }
}
__name(readBookingStatus, "readBookingStatus");
function toPositiveInt(value) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}
__name(toPositiveInt, "toPositiveInt");
function toNonNegativeInt(value) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}
__name(toNonNegativeInt, "toNonNegativeInt");
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
__name(isRecord, "isRecord");
function calculateBookingRevenue(lineItems) {
  let total = 0;
  for (const item of lineItems) {
    const price = parseFloat(item.price || "0");
    if (!isNaN(price)) {
      total += price * item.quantity;
    }
  }
  return total;
}
__name(calculateBookingRevenue, "calculateBookingRevenue");

// src/webhooks.ts
async function handleWebhook(request, env) {
  const topic = request.headers.get("X-Shopify-Topic");
  const hmac = request.headers.get("X-Shopify-Hmac-Sha256");
  const shopDomain = request.headers.get("X-Shopify-Shop-Domain");
  const eventId = request.headers.get("X-Shopify-Webhook-Id");
  if (!topic || !hmac || !shopDomain || !eventId) {
    console.error("Missing webhook headers");
    return new Response("Missing webhook headers", { status: 400 });
  }
  const rawBody = await request.text();
  const valid = await verifyWebhookHmac(rawBody, hmac, env.SHOPIFY_API_SECRET);
  if (!valid) {
    console.error("Invalid webhook HMAC");
    return new Response("Invalid webhook HMAC", { status: 401 });
  }
  try {
    if (topic === "app/uninstalled") {
      await handleAppUninstalled(shopDomain, env);
    } else if (topic === "orders/create") {
      const result = await confirmBookingsFromOrder(env, shopDomain, eventId, topic, rawBody);
      return new Response(result.body, { status: result.status });
    } else {
      console.log("Unhandled webhook topic", topic);
    }
  } catch (e) {
    console.error("Error processing webhook", e);
    return new Response("Internal Server Error", { status: 500 });
  }
  return new Response("Webhook processed");
}
__name(handleWebhook, "handleWebhook");
async function handleAppUninstalled(shopDomain, env) {
  console.log(`Processing app/uninstalled for ${shopDomain}`);
  try {
    await env.DB.prepare(
      `UPDATE shops SET uninstalled_at = datetime('now'), access_token = NULL WHERE shop_domain = ?`
    ).bind(shopDomain).run();
    console.log(`Shop processed uninstall: ${shopDomain}`);
  } catch (e) {
    console.error("Database error during uninstall", e);
    throw e;
  }
}
__name(handleAppUninstalled, "handleAppUninstalled");
async function verifyWebhookHmac(body, hmac, secret) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const data = encoder.encode(body);
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const signature = new Uint8Array(
    atob(hmac).split("").map((c) => c.charCodeAt(0))
  );
  return await crypto.subtle.verify("HMAC", key, signature, data);
}
__name(verifyWebhookHmac, "verifyWebhookHmac");

// src/rateLimit.ts
var store = /* @__PURE__ */ new Map();
function checkRateLimit(key, max, windowMs) {
  const now = Date.now();
  const existing = store.get(key);
  if (!existing || now >= existing.resetAt) {
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: max - 1, resetAt };
  }
  if (existing.count >= max) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }
  existing.count += 1;
  store.set(key, existing);
  return { allowed: true, remaining: max - existing.count, resetAt: existing.resetAt };
}
__name(checkRateLimit, "checkRateLimit");

// src/proxy.ts
var HOLD_MINUTES = 20;
async function handleProxyRequest(request, env) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
  const rate = checkRateLimit(rateLimitKey(request, "proxy"), 240, 6e4);
  if (!rate.allowed) {
    return new Response("Rate limit exceeded", {
      status: 429,
      headers: {
        ...corsHeaders,
        ...rateLimitResponse(rate.resetAt).headers
      }
    });
  }
  if (!shop) {
    return new Response("Missing shop parameter", { status: 400, headers: corsHeaders });
  }
  let response;
  if (url.pathname.endsWith("/availability")) {
    response = await handleAvailability(request, env, shop);
  } else if (url.pathname.endsWith("/hold")) {
    if (request.method.toUpperCase() !== "POST") {
      response = new Response("Method Not Allowed", { status: 405 });
    } else {
      response = await handleHold(request, env, shop);
    }
  } else if (url.pathname.endsWith("/release")) {
    if (request.method.toUpperCase() !== "POST") {
      response = new Response("Method Not Allowed", { status: 405 });
    } else {
      response = await handleRelease(request, env, shop);
    }
  } else if (url.pathname.endsWith("/config")) {
    if (request.method.toUpperCase() !== "GET") {
      response = new Response("Method Not Allowed", { status: 405 });
    } else {
      response = await handleConfig(env, shop);
    }
  } else {
    response = new Response("Not Found", { status: 404 });
  }
  const newHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}
__name(handleProxyRequest, "handleProxyRequest");
async function handleAvailability(request, env, shopDomain) {
  const url = new URL(request.url);
  const startDateStr = url.searchParams.get("start_date");
  const endDateStr = url.searchParams.get("end_date");
  const locationCode = url.searchParams.get("location");
  const quantityStr = url.searchParams.get("quantity");
  const productIdStr = url.searchParams.get("product_id");
  if (!startDateStr || !endDateStr || !quantityStr || !productIdStr) {
    return Response.json({ ok: false, error: "Missing required parameters" }, { status: 400 });
  }
  const quantity = Number(quantityStr);
  const productId = Number(productIdStr);
  if (!Number.isInteger(quantity) || quantity < 1) {
    return Response.json({ ok: false, error: "Invalid quantity" }, { status: 400 });
  }
  if (!Number.isInteger(productId) || productId <= 0) {
    return Response.json({ ok: false, error: "Invalid product id" }, { status: 400 });
  }
  const startParts = parseDateParts(startDateStr);
  const endParts = parseDateParts(endDateStr);
  if (!startParts || !endParts) {
    return Response.json({ ok: false, error: "Invalid dates" }, { status: 400 });
  }
  const startIndex = datePartsToIndex(startParts);
  const endIndex = datePartsToIndex(endParts);
  if (startIndex > endIndex) {
    return Response.json({ ok: false, error: "Start date must be before end date" }, { status: 400 });
  }
  try {
    const shopStmt = await env.DB.prepare("SELECT id FROM shops WHERE shop_domain = ?").bind(shopDomain).first();
    if (!shopStmt) {
      return Response.json({ ok: false, error: "Shop not found" }, { status: 404 });
    }
    const shopId = shopStmt.id;
    if (locationCode) {
      const locStmt = await env.DB.prepare(
        "SELECT id, lead_time_days, min_duration_days FROM locations WHERE shop_id = ? AND code = ? AND active = 1"
      ).bind(shopId, locationCode).first();
      if (!locStmt) {
        return Response.json({ ok: false, error: "Invalid location" }, { status: 400 });
      }
      const todayStr = getTodayInTimeZone(STORE_TIMEZONE);
      const todayParts = parseDateParts(todayStr);
      if (!todayParts) {
        return Response.json({ ok: false, error: "Failed to read store date" }, { status: 500 });
      }
      const todayIndex = datePartsToIndex(todayParts);
      const leadTimeDays = locStmt.lead_time_days;
      const minDurationDays = locStmt.min_duration_days;
      const durationDays = endIndex - startIndex + 1;
      if (startIndex < todayIndex + leadTimeDays) {
        return Response.json({ ok: false, error: "Start date violates lead time" }, { status: 400 });
      }
      if (durationDays < minDurationDays) {
        return Response.json({ ok: false, error: "Below minimum duration" }, { status: 400 });
      }
    }
    const productStmt = await env.DB.prepare(
      "SELECT default_capacity, rentable FROM products WHERE shop_id = ? AND product_id = ?"
    ).bind(shopId, productId).first();
    if (!productStmt) {
      return Response.json({ ok: false, error: "Product not configured for borrowing" }, { status: 404 });
    }
    if (!productStmt.rentable) {
      return Response.json({ ok: false, error: "Product is not rentable" }, { status: 400 });
    }
    const defaultCapacity = productStmt.default_capacity;
    const dateList = listDateStrings(startDateStr, endDateStr);
    if (!dateList) {
      return Response.json({ ok: false, error: "Invalid date range" }, { status: 400 });
    }
    const inventoryRows = await env.DB.prepare(
      "SELECT date, capacity, reserved_qty FROM inventory_day WHERE shop_id = ? AND product_id = ? AND date >= ? AND date <= ?"
    ).bind(shopId, productId, startDateStr, endDateStr).all();
    const inventoryMap = /* @__PURE__ */ new Map();
    if (inventoryRows.results) {
      for (const row of inventoryRows.results) {
        inventoryMap.set(row.date, {
          capacity: row.capacity,
          reserved: row.reserved_qty
        });
      }
    }
    let minAvailable = Infinity;
    for (const dateStr of dateList) {
      let cap = defaultCapacity;
      let res = 0;
      if (inventoryMap.has(dateStr)) {
        const data = inventoryMap.get(dateStr);
        cap = data.capacity;
        res = data.reserved;
      }
      const avail = cap - res;
      if (avail < minAvailable) {
        minAvailable = avail;
      }
    }
    const isAvailable = minAvailable >= quantity;
    return Response.json({
      ok: true,
      available: isAvailable,
      min_available_qty: minAvailable
    });
  } catch (e) {
    console.error("Availability check failed", e);
    return Response.json({ ok: false, error: "Internal Server Error" }, { status: 500 });
  }
}
__name(handleAvailability, "handleAvailability");
async function handleHold(request, env, shopDomain) {
  const body = await readJsonBody(request);
  if (!body) {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = parseHoldBody(body);
  if (!parsed) {
    return Response.json({ ok: false, error: "Invalid hold request" }, { status: 400 });
  }
  try {
    const shopStmt = await env.DB.prepare("SELECT id FROM shops WHERE shop_domain = ?").bind(shopDomain).first();
    if (!shopStmt) {
      return Response.json({ ok: false, error: "Shop not found" }, { status: 404 });
    }
    const shopId = shopStmt.id;
    const location = await env.DB.prepare(
      "SELECT code, lead_time_days, min_duration_days FROM locations WHERE shop_id = ? AND code = ? AND active = 1"
    ).bind(shopId, parsed.location).first();
    if (!location) {
      return Response.json({ ok: false, error: "Invalid location" }, { status: 400 });
    }
    const startParts = parseDateParts(parsed.start_date);
    const endParts = parseDateParts(parsed.end_date);
    if (!startParts || !endParts) {
      return Response.json({ ok: false, error: "Invalid dates" }, { status: 400 });
    }
    const startIndex = datePartsToIndex(startParts);
    const endIndex = datePartsToIndex(endParts);
    if (startIndex > endIndex) {
      return Response.json({ ok: false, error: "Start date must be before end date" }, { status: 400 });
    }
    const todayStr = getTodayInTimeZone(STORE_TIMEZONE);
    const todayParts = parseDateParts(todayStr);
    if (!todayParts) {
      return Response.json({ ok: false, error: "Failed to read store date" }, { status: 500 });
    }
    const todayIndex = datePartsToIndex(todayParts);
    const leadTimeDays = location.lead_time_days;
    const minDurationDays = location.min_duration_days;
    const durationDays = endIndex - startIndex + 1;
    if (startIndex < todayIndex + leadTimeDays) {
      return Response.json({ ok: false, error: "Start date violates lead time" }, { status: 400 });
    }
    if (durationDays < minDurationDays) {
      return Response.json({ ok: false, error: "Below minimum duration" }, { status: 400 });
    }
    const uniqueProductIds = Array.from(new Set(parsed.items.map((item) => item.product_id)));
    const placeholders = uniqueProductIds.map(() => "?").join(", ");
    const productRows = await env.DB.prepare(
      `SELECT product_id, variant_id, rentable, default_capacity FROM products WHERE shop_id = ? AND product_id IN (${placeholders})`
    ).bind(shopId, ...uniqueProductIds).all();
    const productMap = /* @__PURE__ */ new Map();
    for (const row of productRows.results ?? []) {
      productMap.set(row.product_id, {
        variant_id: row.variant_id,
        rentable: row.rentable,
        default_capacity: row.default_capacity
      });
    }
    const normalizedItems = normalizeHoldItems(parsed.items, productMap);
    if (!normalizedItems) {
      return Response.json({ ok: false, error: "Invalid product configuration" }, { status: 400 });
    }
    const dateList = listDateStrings(parsed.start_date, parsed.end_date);
    if (!dateList) {
      return Response.json({ ok: false, error: "Invalid date range" }, { status: 400 });
    }
    const bookingId = crypto.randomUUID();
    const bookingToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + HOLD_MINUTES * 60 * 1e3).toISOString();
    const statements = [];
    statements.push(
      env.DB.prepare(
        `INSERT INTO bookings (id, shop_id, booking_token, status, location_code, start_date, end_date, expires_at, created_at, updated_at)
                 VALUES (?, ?, ?, 'HOLD', ?, ?, ?, ?, datetime('now'), datetime('now'))`
      ).bind(bookingId, shopId, bookingToken, parsed.location, parsed.start_date, parsed.end_date, expiresAt)
    );
    for (const item of normalizedItems) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO booking_items (booking_id, product_id, variant_id, qty)
                     VALUES (?, ?, ?, ?)`
        ).bind(bookingId, item.product_id, item.variant_id, item.qty)
      );
    }
    for (const date of dateList) {
      for (const item of normalizedItems) {
        statements.push(
          env.DB.prepare(
            `INSERT OR IGNORE INTO inventory_day (shop_id, product_id, date, capacity, reserved_qty)
                         VALUES (?, ?, ?, ?, 0)`
          ).bind(shopId, item.product_id, date, item.default_capacity)
        );
        statements.push(
          env.DB.prepare(
            `UPDATE inventory_day
                         SET reserved_qty = reserved_qty + ?
                         WHERE shop_id = ? AND product_id = ? AND date = ? AND reserved_qty + ? <= capacity`
          ).bind(item.qty, shopId, item.product_id, date, item.qty)
        );
        statements.push(env.DB.prepare("SELECT CASE WHEN changes() = 1 THEN 1 ELSE 1/0 END;"));
        statements.push(
          env.DB.prepare(
            `INSERT INTO booking_days (booking_id, product_id, date, qty)
                         VALUES (?, ?, ?, ?)`
          ).bind(bookingId, item.product_id, date, item.qty)
        );
      }
    }
    await env.DB.batch(statements);
    return Response.json({
      ok: true,
      booking_token: bookingToken,
      expires_at: expiresAt
    });
  } catch (e) {
    console.error("Hold failed", e);
    if (String(e).includes("division")) {
      return Response.json({ ok: false, error: "Insufficient capacity" }, { status: 409 });
    }
    return Response.json({ ok: false, error: "Internal Server Error" }, { status: 500 });
  }
}
__name(handleHold, "handleHold");
async function handleRelease(request, env, shopDomain) {
  const body = await readJsonBody(request);
  if (!body) {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const token = getString(body, "booking_token");
  if (!token) {
    return Response.json({ ok: false, error: "Missing booking token" }, { status: 400 });
  }
  try {
    const shopStmt = await env.DB.prepare("SELECT id FROM shops WHERE shop_domain = ?").bind(shopDomain).first();
    if (!shopStmt) {
      return Response.json({ ok: false, error: "Shop not found" }, { status: 404 });
    }
    const shopId = shopStmt.id;
    const booking = await env.DB.prepare(
      "SELECT id, status FROM bookings WHERE shop_id = ? AND booking_token = ?"
    ).bind(shopId, token).first();
    if (!booking) {
      return Response.json({ ok: false, error: "Booking not found" }, { status: 404 });
    }
    if (booking.status !== "HOLD") {
      return Response.json({ ok: true, status: booking.status });
    }
    await releaseBooking(env.DB, booking.id, "RELEASED");
    return Response.json({ ok: true, status: "RELEASED" });
  } catch (e) {
    console.error("Release failed", e);
    return Response.json({ ok: false, error: "Internal Server Error" }, { status: 500 });
  }
}
__name(handleRelease, "handleRelease");
async function handleConfig(env, shopDomain) {
  try {
    const shopStmt = await env.DB.prepare("SELECT id, shop_domain, access_token FROM shops WHERE shop_domain = ?").bind(shopDomain).first();
    if (!shopStmt) {
      return Response.json({ ok: false, error: "Shop not found" }, { status: 404 });
    }
    const shopId = shopStmt.id;
    const accessToken = shopStmt.access_token;
    const locations = await env.DB.prepare(
      "SELECT code, name, lead_time_days, min_duration_days FROM locations WHERE shop_id = ? AND active = 1 ORDER BY name"
    ).bind(shopId).all();
    const productsRows = await env.DB.prepare(
      "SELECT product_id, variant_id, default_capacity, deposit_variant_id, deposit_multiplier FROM products WHERE shop_id = ? AND rentable = 1 ORDER BY product_id"
    ).bind(shopId).all();
    const products = productsRows.results ?? [];
    if (products.length > 0) {
      const productIds = products.map((p) => `gid://shopify/Product/${p.product_id}`);
      const query = `
            query ($ids: [ID!]!) {
              nodes(ids: $ids) {
                ... on Product {
                  id
                  title
                }
              }
            }
            `;
      try {
        const shopifyRes = await fetch(`https://${shopDomain}/admin/api/2025-10/graphql.json`, {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            query,
            variables: { ids: productIds }
          })
        });
        if (shopifyRes.ok) {
          const shopifyData = await shopifyRes.json();
          const nodes = shopifyData.data?.nodes || [];
          const titleMap = /* @__PURE__ */ new Map();
          nodes.forEach((node) => {
            if (node && node.id) {
              const id = parseInt(node.id.split("/").pop() || "0");
              titleMap.set(id, node.title);
            }
          });
          products.forEach((p) => {
            p.title = titleMap.get(p.product_id) || `Product ${p.product_id}`;
          });
        } else {
          console.error("Failed to fetch Shopify products", await shopifyRes.text());
        }
      } catch (err) {
        console.error("Error fetching Shopify products", err);
      }
    }
    return Response.json({
      ok: true,
      locations: locations.results ?? [],
      products
    });
  } catch (e) {
    console.error("Config fetch failed", e);
    return Response.json({ ok: false, error: "Internal Server Error" }, { status: 500 });
  }
}
__name(handleConfig, "handleConfig");
function normalizeHoldItems(items, productMap) {
  const map = /* @__PURE__ */ new Map();
  for (const item of items) {
    const product = productMap.get(item.product_id);
    if (!product || !product.rentable) {
      return null;
    }
    const defaultCapacity = product.default_capacity;
    if (!Number.isInteger(defaultCapacity) || defaultCapacity < 0) {
      return null;
    }
    const variantId = product.variant_id ?? item.variant_id;
    if (variantId === void 0 || variantId === null || !Number.isInteger(variantId) || variantId <= 0) {
      return null;
    }
    if (product.variant_id && item.variant_id && product.variant_id !== item.variant_id) {
      return null;
    }
    const existing = map.get(item.product_id);
    if (existing) {
      if (existing.variant_id !== variantId) {
        return null;
      }
      existing.qty += item.qty;
      map.set(item.product_id, existing);
      continue;
    }
    map.set(item.product_id, {
      product_id: item.product_id,
      variant_id: variantId,
      qty: item.qty,
      default_capacity: defaultCapacity
    });
  }
  return Array.from(map.values());
}
__name(normalizeHoldItems, "normalizeHoldItems");
function parseHoldBody(body) {
  const startDate = getString(body, "start_date");
  const endDate = getString(body, "end_date");
  const location = getString(body, "location");
  const items = body.items;
  if (!startDate || !endDate || !location || !Array.isArray(items) || items.length === 0) {
    return null;
  }
  const parsedItems = [];
  for (const entry of items) {
    if (!isRecord2(entry)) {
      return null;
    }
    const productId = getNumber(entry, "product_id");
    const qty = getNumber(entry, "qty");
    const variantId = getOptionalNumber(entry, "variant_id");
    if (productId === null || !Number.isInteger(productId) || productId <= 0) {
      return null;
    }
    if (qty === null || !Number.isInteger(qty) || qty <= 0) {
      return null;
    }
    if (variantId !== void 0 && (!Number.isInteger(variantId) || variantId <= 0)) {
      return null;
    }
    parsedItems.push({
      product_id: productId,
      variant_id: variantId,
      qty
    });
  }
  return {
    start_date: startDate,
    end_date: endDate,
    location,
    items: parsedItems
  };
}
__name(parseHoldBody, "parseHoldBody");
function rateLimitKey(request, scope) {
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  return `${scope}:${ip}`;
}
__name(rateLimitKey, "rateLimitKey");
function rateLimitResponse(resetAt) {
  const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1e3));
  return new Response("Rate limit exceeded", {
    status: 429,
    headers: {
      "Retry-After": retryAfter.toString()
    }
  });
}
__name(rateLimitResponse, "rateLimitResponse");
async function readJsonBody(request) {
  try {
    const data = await request.json();
    return isRecord2(data) ? data : null;
  } catch {
    return null;
  }
}
__name(readJsonBody, "readJsonBody");
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
__name(isRecord2, "isRecord");
function getString(record, key) {
  const value = record[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
__name(getString, "getString");
function getNumber(record, key) {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}
__name(getNumber, "getNumber");
function getOptionalNumber(record, key) {
  if (!(key in record)) {
    return void 0;
  }
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return void 0;
  }
  return value;
}
__name(getOptionalNumber, "getOptionalNumber");

// src/admin.ts
async function handleAdminRequest(request, env) {
  const rate = checkRateLimit(rateLimitKey2(request, "admin"), 120, 6e4);
  if (!rate.allowed) {
    return rateLimitResponse2(rate.resetAt);
  }
  const auth = await requireAdminAuth(request, env);
  if (auth instanceof Response) {
    return auth;
  }
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/admin/, "");
  const segments = path.split("/").filter(Boolean);
  const method = request.method.toUpperCase();
  if (segments.length === 1 && segments[0] === "locations") {
    if (method === "GET") {
      return handleLocationsGet(env, auth.shopId);
    }
    if (method === "POST") {
      return handleLocationsPost(request, env, auth.shopId);
    }
  }
  if (segments.length === 2 && segments[0] === "locations") {
    if (method === "PATCH") {
      const id = parsePositiveInt(segments[1]);
      if (!id) {
        return jsonError("Invalid location id", 400);
      }
      return handleLocationsPatch(request, env, auth.shopId, id);
    }
  }
  if (segments.length === 1 && segments[0] === "products") {
    if (method === "GET") {
      return handleProductsGet(env, auth.shopId);
    }
  }
  if (segments.length === 2 && segments[0] === "products") {
    if (method === "PATCH") {
      const productId = parsePositiveInt(segments[1]);
      if (!productId) {
        return jsonError("Invalid product id", 400);
      }
      return handleProductsPatch(request, env, auth.shopId, productId);
    }
    if (method === "DELETE") {
      const productId = parsePositiveInt(segments[1]);
      if (!productId) {
        return jsonError("Invalid product id", 400);
      }
      return handleProductsDelete(env, auth.shopId, productId);
    }
  }
  if (segments.length === 1 && segments[0] === "inventory") {
    if (method === "GET") {
      return handleInventoryGet(request, env, auth.shopId);
    }
    if (method === "PUT") {
      return handleInventoryPut(request, env, auth.shopId);
    }
  }
  if (segments.length === 1 && segments[0] === "bookings") {
    if (method === "GET") {
      return handleBookingsGet(request, env, auth.shopId);
    }
  }
  if (segments.length === 1 && segments[0] === "dashboard") {
    if (method === "GET") {
      return handleDashboardGet(env, auth.shopId);
    }
  }
  if (segments.length === 2 && segments[0] === "bookings") {
    if (method === "GET") {
      return handleBookingGet(env, auth.shopId, segments[1]);
    }
  }
  if (segments.length === 3 && segments[0] === "bookings" && segments[2] === "complete") {
    if (method === "POST") {
      return handleBookingComplete(env, auth.shopId, segments[1]);
    }
  }
  if (segments.length === 1 && segments[0] === "shopify-products") {
    if (method === "GET") {
      return handleShopifyProductsGet(env, auth.shopId);
    }
  }
  return new Response("Not Found", { status: 404 });
}
__name(handleAdminRequest, "handleAdminRequest");
async function requireAdminAuth(request, env) {
  const token = getBearerToken(request);
  if (!token) {
    return jsonError("Missing session token", 401);
  }
  const payload = await verifySessionToken(
    token,
    env.SHOPIFY_API_SECRET,
    env.SHOPIFY_API_KEY,
    env.SHOPIFY_JWKS_URL
  );
  if (!payload) {
    return jsonError("Invalid session token", 401);
  }
  const shopDomain = safeUrlHost2(payload.dest);
  if (!shopDomain) {
    return jsonError("Invalid token destination", 401);
  }
  const shopRow = await env.DB.prepare("SELECT id FROM shops WHERE shop_domain = ? AND uninstalled_at IS NULL").bind(shopDomain).first();
  if (!shopRow) {
    return jsonError("Shop not found", 401);
  }
  return {
    shopId: shopRow.id,
    shopDomain,
    payload
  };
}
__name(requireAdminAuth, "requireAdminAuth");
async function handleLocationsGet(env, shopId) {
  const rows = await env.DB.prepare(
    "SELECT id, code, name, lead_time_days, min_duration_days, active FROM locations WHERE shop_id = ? ORDER BY name"
  ).bind(shopId).all();
  return Response.json({ ok: true, locations: rows.results ?? [] });
}
__name(handleLocationsGet, "handleLocationsGet");
async function handleLocationsPost(request, env, shopId) {
  const body = await readJsonBody2(request);
  if (!body) {
    return jsonError("Invalid JSON body", 400);
  }
  const code = getString2(body, "code");
  const name = getString2(body, "name");
  if (!code || !name) {
    return jsonError("Missing required fields", 400);
  }
  const leadTimeDays = getOptionalNumber2(body, "lead_time_days");
  const minDurationDays = getOptionalNumber2(body, "min_duration_days");
  const active = getOptionalBoolean(body, "active");
  const leadValue = leadTimeDays ?? 1;
  const minValue = minDurationDays ?? 1;
  if (!Number.isInteger(leadValue) || leadValue < 0 || !Number.isInteger(minValue) || minValue < 1) {
    return jsonError("Invalid lead time or minimum duration", 400);
  }
  try {
    await env.DB.prepare(
      `INSERT INTO locations (shop_id, code, name, lead_time_days, min_duration_days, active)
             VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(shopId, code, name, leadValue, minValue, active ?? true).run();
    return Response.json({ ok: true });
  } catch (e) {
    console.error("Locations insert failed", e);
    return jsonError("Failed to create location", 500);
  }
}
__name(handleLocationsPost, "handleLocationsPost");
async function handleLocationsPatch(request, env, shopId, locationId) {
  const body = await readJsonBody2(request);
  if (!body) {
    return jsonError("Invalid JSON body", 400);
  }
  const existing = await env.DB.prepare(
    "SELECT code, name, lead_time_days, min_duration_days, active FROM locations WHERE shop_id = ? AND id = ?"
  ).bind(shopId, locationId).first();
  if (!existing) {
    return jsonError("Location not found", 404);
  }
  const code = getOptionalString(body, "code") ?? existing.code;
  const name = getOptionalString(body, "name") ?? existing.name;
  const leadTimeDays = getOptionalNumber2(body, "lead_time_days") ?? existing.lead_time_days;
  const minDurationDays = getOptionalNumber2(body, "min_duration_days") ?? existing.min_duration_days;
  const active = getOptionalBoolean(body, "active") ?? Boolean(existing.active);
  if (!code || !name) {
    return jsonError("Invalid location fields", 400);
  }
  if (!Number.isInteger(leadTimeDays) || leadTimeDays < 0 || !Number.isInteger(minDurationDays) || minDurationDays < 1) {
    return jsonError("Invalid lead time or minimum duration", 400);
  }
  await env.DB.prepare(
    `UPDATE locations
         SET code = ?, name = ?, lead_time_days = ?, min_duration_days = ?, active = ?
         WHERE shop_id = ? AND id = ?`
  ).bind(code, name, leadTimeDays, minDurationDays, active, shopId, locationId).run();
  return Response.json({ ok: true });
}
__name(handleLocationsPatch, "handleLocationsPatch");
async function handleProductsGet(env, shopId) {
  const rows = await env.DB.prepare(
    "SELECT product_id, variant_id, rentable, default_capacity, deposit_variant_id, deposit_multiplier, updated_at FROM products WHERE shop_id = ? ORDER BY product_id"
  ).bind(shopId).all();
  return Response.json({ ok: true, products: rows.results ?? [] });
}
__name(handleProductsGet, "handleProductsGet");
async function handleProductsPatch(request, env, shopId, productId) {
  const body = await readJsonBody2(request);
  if (!body) {
    return jsonError("Invalid JSON body", 400);
  }
  const rentable = getOptionalBoolean(body, "rentable");
  const defaultCapacity = getOptionalNumber2(body, "default_capacity");
  const variantId = getOptionalNumber2(body, "variant_id");
  const depositVariantId = getOptionalNumber2(body, "deposit_variant_id");
  const depositMultiplier = getOptionalNumber2(body, "deposit_multiplier");
  if (defaultCapacity !== void 0 && (!Number.isInteger(defaultCapacity) || defaultCapacity < 0)) {
    return jsonError("Invalid default capacity", 400);
  }
  if (depositMultiplier !== void 0 && (!Number.isInteger(depositMultiplier) || depositMultiplier < 1)) {
    return jsonError("Invalid deposit multiplier", 400);
  }
  await env.DB.prepare(
    `INSERT INTO products (
            shop_id, product_id, variant_id, rentable, default_capacity,
            deposit_variant_id, deposit_multiplier, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(shop_id, product_id) DO UPDATE SET
            variant_id = COALESCE(excluded.variant_id, products.variant_id),
            rentable = COALESCE(excluded.rentable, products.rentable),
            default_capacity = COALESCE(excluded.default_capacity, products.default_capacity),
            deposit_variant_id = COALESCE(excluded.deposit_variant_id, products.deposit_variant_id),
            deposit_multiplier = COALESCE(excluded.deposit_multiplier, products.deposit_multiplier),
            updated_at = datetime('now')`
  ).bind(
    shopId,
    productId,
    variantId ?? null,
    rentable ?? null,
    defaultCapacity ?? null,
    depositVariantId ?? null,
    depositMultiplier ?? null
  ).run();
  return Response.json({ ok: true });
}
__name(handleProductsPatch, "handleProductsPatch");
async function handleProductsDelete(env, shopId, productId) {
  await env.DB.prepare("DELETE FROM products WHERE shop_id = ? AND product_id = ?").bind(shopId, productId).run();
  return Response.json({ ok: true });
}
__name(handleProductsDelete, "handleProductsDelete");
async function handleInventoryGet(request, env, shopId) {
  const url = new URL(request.url);
  const productId = parsePositiveInt(url.searchParams.get("product_id") || "");
  const startDate = url.searchParams.get("start_date");
  const endDate = url.searchParams.get("end_date");
  if (!productId || !startDate || !endDate) {
    return jsonError("Missing required parameters", 400);
  }
  const dateList = listDateStrings(startDate, endDate);
  if (!dateList) {
    return jsonError("Invalid date range", 400);
  }
  const product = await env.DB.prepare(
    "SELECT default_capacity FROM products WHERE shop_id = ? AND product_id = ?"
  ).bind(shopId, productId).first();
  if (!product) {
    return jsonError("Product not found", 404);
  }
  const defaultCapacity = product.default_capacity;
  const rows = await env.DB.prepare(
    "SELECT date, capacity, reserved_qty FROM inventory_day WHERE shop_id = ? AND product_id = ? AND date >= ? AND date <= ?"
  ).bind(shopId, productId, startDate, endDate).all();
  const map = /* @__PURE__ */ new Map();
  for (const row of rows.results ?? []) {
    map.set(row.date, {
      capacity: row.capacity,
      reserved_qty: row.reserved_qty
    });
  }
  const inventory = dateList.map((date) => {
    const found = map.get(date);
    return {
      date,
      capacity: found ? found.capacity : defaultCapacity,
      reserved_qty: found ? found.reserved_qty : 0
    };
  });
  return Response.json({ ok: true, inventory });
}
__name(handleInventoryGet, "handleInventoryGet");
async function handleInventoryPut(request, env, shopId) {
  const body = await readJsonBody2(request);
  if (!body) {
    return jsonError("Invalid JSON body", 400);
  }
  const productId = getNumber2(body, "product_id");
  if (!productId || !Number.isInteger(productId) || productId <= 0) {
    return jsonError("Invalid product id", 400);
  }
  const overrides = body.overrides;
  if (!Array.isArray(overrides) || overrides.length === 0) {
    return jsonError("Missing overrides", 400);
  }
  const normalized = [];
  const seenDates = /* @__PURE__ */ new Set();
  for (const entry of overrides) {
    if (!isRecord3(entry)) {
      return jsonError("Invalid override entry", 400);
    }
    const date = getString2(entry, "date");
    const capacity = getNumber2(entry, "capacity");
    if (date === null || !parseDateParts(date)) {
      return jsonError("Invalid override date", 400);
    }
    if (capacity === null || !Number.isInteger(capacity) || capacity < 0) {
      return jsonError("Invalid override capacity", 400);
    }
    if (seenDates.has(date)) {
      return jsonError("Duplicate override date", 400);
    }
    seenDates.add(date);
    normalized.push({ date, capacity });
  }
  const statements = [];
  for (const override of normalized) {
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO inventory_day (shop_id, product_id, date, capacity, reserved_qty)
                 VALUES (?, ?, ?, ?, 0)`
      ).bind(shopId, productId, override.date, override.capacity)
    );
    statements.push(
      env.DB.prepare(
        `UPDATE inventory_day
                 SET capacity = ?
                 WHERE shop_id = ? AND product_id = ? AND date = ? AND reserved_qty <= ?`
      ).bind(override.capacity, shopId, productId, override.date, override.capacity)
    );
    statements.push(
      env.DB.prepare(
        `SELECT CASE WHEN EXISTS (
                    SELECT 1 FROM inventory_day
                    WHERE shop_id = ? AND product_id = ? AND date = ? AND reserved_qty <= ?
                ) THEN 1 ELSE 1/0 END;`
      ).bind(shopId, productId, override.date, override.capacity)
    );
  }
  try {
    await env.DB.batch(statements);
  } catch (e) {
    console.error("Inventory override failed", e);
    return jsonError("Inventory override failed", 409);
  }
  return Response.json({ ok: true });
}
__name(handleInventoryPut, "handleInventoryPut");
async function handleBookingsGet(request, env, shopId) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const startDate = url.searchParams.get("start_date");
  const endDate = url.searchParams.get("end_date");
  const search = url.searchParams.get("search");
  if (startDate && !parseDateParts(startDate) || endDate && !parseDateParts(endDate)) {
    return jsonError("Invalid date range", 400);
  }
  let sql = "SELECT booking_token, status, location_code, start_date, end_date, order_id, invalid_reason, created_at, updated_at, customer_name, customer_email, revenue, fulfillment_type, delivery_address FROM bookings WHERE shop_id = ?";
  const bindings = [shopId];
  if (status) {
    sql += " AND status = ?";
    bindings.push(status);
  }
  if (startDate) {
    sql += " AND start_date >= ?";
    bindings.push(startDate);
  }
  if (endDate) {
    sql += " AND end_date <= ?";
    bindings.push(endDate);
  }
  if (search) {
    const term = `%${search}%`;
    sql += " AND (booking_token LIKE ? OR order_id LIKE ? OR customer_name LIKE ? OR customer_email LIKE ?)";
    bindings.push(term, term, term, term);
  }
  sql += " ORDER BY start_date DESC";
  const rows = await env.DB.prepare(sql).bind(...bindings).all();
  return Response.json({ ok: true, bookings: rows.results ?? [] });
}
__name(handleBookingsGet, "handleBookingsGet");
async function handleBookingGet(env, shopId, bookingToken) {
  const booking = await env.DB.prepare(
    `SELECT id, booking_token, status, location_code, start_date, end_date, expires_at, order_id, invalid_reason, created_at, updated_at, customer_name, customer_email, revenue, fulfillment_type, delivery_address
         FROM bookings WHERE shop_id = ? AND booking_token = ?`
  ).bind(shopId, bookingToken).first();
  if (!booking) {
    return jsonError("Booking not found", 404);
  }
  const items = await env.DB.prepare(
    "SELECT product_id, variant_id, qty FROM booking_items WHERE booking_id = ? ORDER BY product_id"
  ).bind(booking.id).all();
  const days = await env.DB.prepare(
    "SELECT product_id, date, qty FROM booking_days WHERE booking_id = ? ORDER BY date, product_id"
  ).bind(booking.id).all();
  return Response.json({
    ok: true,
    booking,
    items: items.results ?? [],
    days: days.results ?? []
  });
}
__name(handleBookingGet, "handleBookingGet");
async function handleDashboardGet(env, shopId) {
  const today = getTodayInTimeZone(STORE_TIMEZONE);
  const activeBookingsStmt = env.DB.prepare(
    `SELECT COUNT(*) as count FROM bookings 
         WHERE shop_id = ? AND status = 'CONFIRMED' AND start_date <= ? AND end_date >= ?`
  ).bind(shopId, today, today);
  const pendingHoldsStmt = env.DB.prepare(
    `SELECT COUNT(*) as count FROM bookings 
         WHERE shop_id = ? AND status = 'HOLD'`
  ).bind(shopId);
  const pickupsStmt = env.DB.prepare(
    `SELECT booking_token, location_code, order_id, status FROM bookings 
         WHERE shop_id = ? AND start_date = ? AND status IN ('CONFIRMED', 'HOLD')`
  ).bind(shopId, today);
  const dropoffsStmt = env.DB.prepare(
    `SELECT booking_token, location_code, order_id, status FROM bookings 
         WHERE shop_id = ? AND end_date = ? AND status IN ('CONFIRMED', 'HOLD')`
  ).bind(shopId, today);
  const upcomingStmt = env.DB.prepare(
    `SELECT booking_token, start_date, end_date, location_code, status, order_id, customer_name FROM bookings 
         WHERE shop_id = ? AND start_date > ? AND status = 'CONFIRMED' 
         ORDER BY start_date ASC LIMIT 5`
  ).bind(shopId, today);
  const historyStmt = env.DB.prepare(
    `SELECT booking_token, start_date, end_date, status, created_at, invalid_reason FROM bookings 
         WHERE shop_id = ? 
         ORDER BY created_at DESC LIMIT 10`
  ).bind(shopId);
  const bookingsCountStmt = env.DB.prepare(
    `SELECT COUNT(*) as count FROM bookings WHERE shop_id = ? AND status = 'CONFIRMED'`
  ).bind(shopId);
  const cancelledCountStmt = env.DB.prepare(
    `SELECT COUNT(*) as count FROM bookings WHERE shop_id = ? AND status IN ('CANCELLED', 'EXPIRED', 'INVALID')`
  ).bind(shopId);
  const revenueStmt = env.DB.prepare(
    `SELECT SUM(revenue) as total FROM bookings WHERE shop_id = ? AND status = 'CONFIRMED'`
  ).bind(shopId);
  const results = await env.DB.batch([
    activeBookingsStmt,
    pendingHoldsStmt,
    pickupsStmt,
    dropoffsStmt,
    upcomingStmt,
    historyStmt,
    bookingsCountStmt,
    cancelledCountStmt,
    revenueStmt,
    // Product breakdown (count only for now)
    env.DB.prepare(
      `SELECT product_id, COUNT(*) as count 
             FROM booking_items 
             JOIN bookings ON bookings.id = booking_items.booking_id 
             WHERE bookings.shop_id = ? AND bookings.status = 'CONFIRMED' 
             GROUP BY product_id`
    ).bind(shopId)
  ]);
  const productStats = results.length > 9 ? results[9].results : [];
  return Response.json({
    ok: true,
    todayDate: today,
    stats: {
      active_bookings: results[0].results?.[0]?.count ?? 0,
      pending_holds: results[1].results?.[0]?.count ?? 0,
      bookings_count: results[6].results?.[0]?.count ?? 0,
      cancelled_count: results[7].results?.[0]?.count ?? 0,
      revenue: results[8].results?.[0]?.total ?? 0
    },
    productStats: productStats ?? [],
    todayActivity: {
      pickups: results[2].results ?? [],
      dropoffs: results[3].results ?? []
    },
    upcomingBookings: results[4].results ?? [],
    recentHistory: results[5].results ?? []
  });
}
__name(handleDashboardGet, "handleDashboardGet");
async function handleBookingComplete(env, shopId, bookingToken) {
  const booking = await env.DB.prepare(
    `SELECT id, order_id, status FROM bookings WHERE shop_id = ? AND booking_token = ?`
  ).bind(shopId, bookingToken).first();
  if (!booking) {
    return jsonError("Booking not found", 404);
  }
  const orderId = booking.order_id;
  let fulfillmentResult = { success: false, message: "No Order ID" };
  if (orderId) {
    fulfillmentResult = await fulfillShopifyOrder(env, shopId, orderId);
  }
  await env.DB.prepare(
    `UPDATE bookings SET status = 'RELEASED', updated_at = datetime('now') WHERE id = ?`
  ).bind(booking.id).run();
  return Response.json({ ok: true, fulfillment: fulfillmentResult });
}
__name(handleBookingComplete, "handleBookingComplete");
async function fulfillShopifyOrder(env, shopId, orderId) {
  const shopRow = await env.DB.prepare("SELECT shop_domain, access_token FROM shops WHERE id = ?").bind(shopId).first();
  if (!shopRow) return { success: false, message: "Shop not found" };
  const { shop_domain, access_token } = shopRow;
  const foRes = await fetch(`https://${shop_domain}/admin/api/2025-10/orders/${orderId}/fulfillment_orders.json`, {
    headers: { "X-Shopify-Access-Token": access_token }
  });
  if (!foRes.ok) return { success: false, message: "Failed to fetch fulfillment orders" };
  const foData = await foRes.json();
  const fulfillmentOrders = foData.fulfillment_orders;
  if (!fulfillmentOrders || fulfillmentOrders.length === 0) {
    return { success: false, message: "No fulfillment orders found" };
  }
  const openOrders = fulfillmentOrders.filter((fo) => fo.status === "open");
  if (openOrders.length === 0) return { success: true, message: "Order already fulfilled" };
  const targetFo = openOrders[0];
  const payload = {
    fulfillment: {
      line_items_by_fulfillment_order: [{
        fulfillment_order_id: targetFo.id
      }]
    }
  };
  const createRes = await fetch(`https://${shop_domain}/admin/api/2025-10/fulfillments.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": access_token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!createRes.ok) {
    const txt = await createRes.text();
    console.error("Fulfillment failed", txt);
    return { success: false, message: "Fulfillment failed" };
  }
  return { success: true, message: "Fulfilled" };
}
__name(fulfillShopifyOrder, "fulfillShopifyOrder");
async function handleShopifyProductsGet(env, shopId) {
  const shopRow = await env.DB.prepare("SELECT shop_domain, access_token FROM shops WHERE id = ?").bind(shopId).first();
  if (!shopRow) return jsonError("Shop not found", 404);
  const { shop_domain, access_token } = shopRow;
  const query = `
    {
      products(first: 50, sortKey: TITLE) {
        edges {
          node {
            id
            title
            status
            images(first: 1) {
              edges {
                node {
                  url
                }
              }
            }
            variants(first: 20) {
              edges {
                node {
                  id
                  title
                }
              }
            }
          }
        }
      }
    }
    `;
  try {
    const response = await fetch(`https://${shop_domain}/admin/api/2025-10/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": access_token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query })
    });
    if (!response.ok) {
      const text = await response.text();
      console.error("GraphQL HTTP Error", text);
      return jsonError("Failed to fetch products from Shopify (HTTP)", 502);
    }
    const body = await response.json();
    if (body.errors) {
      console.error("GraphQL Errors", JSON.stringify(body.errors));
      return jsonError("Failed to fetch products from Shopify (GraphQL)", 502);
    }
    const rawProducts = body.data?.products?.edges || [];
    const products = rawProducts.map((edge) => {
      const node = edge.node;
      const productId = parseInt(node.id.split("/").pop() || "0");
      return {
        id: productId,
        title: node.title,
        status: node.status,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        images: node.images.edges.map((imgEdge) => ({
          src: imgEdge.node.url
        })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        variants: node.variants.edges.map((varEdge) => ({
          id: parseInt(varEdge.node.id.split("/").pop() || "0"),
          title: varEdge.node.title
        }))
      };
    });
    return Response.json({ ok: true, products });
  } catch (e) {
    console.error("Shopify fetch exception", e);
    return jsonError("Exception fetching products", 500);
  }
}
__name(handleShopifyProductsGet, "handleShopifyProductsGet");
function rateLimitKey2(request, scope) {
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  return `${scope}:${ip}`;
}
__name(rateLimitKey2, "rateLimitKey");
function rateLimitResponse2(resetAt) {
  const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1e3));
  return new Response("Rate limit exceeded", {
    status: 429,
    headers: {
      "Retry-After": retryAfter.toString()
    }
  });
}
__name(rateLimitResponse2, "rateLimitResponse");
function getBearerToken(request) {
  const auth = request.headers.get("Authorization");
  if (auth && auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }
  const token = request.headers.get("X-Shopify-Session-Token") || request.headers.get("X-Shopify-Access-Token");
  return token ? token.trim() : null;
}
__name(getBearerToken, "getBearerToken");
function safeUrlHost2(value) {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}
__name(safeUrlHost2, "safeUrlHost");
function parsePositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}
__name(parsePositiveInt, "parsePositiveInt");
async function readJsonBody2(request) {
  try {
    const data = await request.json();
    return isRecord3(data) ? data : null;
  } catch {
    return null;
  }
}
__name(readJsonBody2, "readJsonBody");
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
__name(isRecord3, "isRecord");
function getString2(record, key) {
  const value = record[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
__name(getString2, "getString");
function getOptionalString(record, key) {
  if (!(key in record)) {
    return void 0;
  }
  const value = record[key];
  if (typeof value !== "string") {
    return void 0;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : void 0;
}
__name(getOptionalString, "getOptionalString");
function getNumber2(record, key) {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}
__name(getNumber2, "getNumber");
function getOptionalNumber2(record, key) {
  if (!(key in record)) {
    return void 0;
  }
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return void 0;
  }
  return value;
}
__name(getOptionalNumber2, "getOptionalNumber");
function getOptionalBoolean(record, key) {
  if (!(key in record)) {
    return void 0;
  }
  const value = record[key];
  if (typeof value !== "boolean") {
    return void 0;
  }
  return value;
}
__name(getOptionalBoolean, "getOptionalBoolean");
function jsonError(message, status) {
  return Response.json({ ok: false, error: message }, { status });
}
__name(jsonError, "jsonError");

// src/scheduled.ts
async function handleScheduled(event, env) {
  console.log("Running hold cleanup cron", event.cron);
  const expired = await env.DB.prepare(
    "SELECT id FROM bookings WHERE status = 'HOLD' AND datetime(expires_at) <= datetime('now')"
  ).all();
  for (const row of expired.results ?? []) {
    const bookingId = row.id;
    if (!bookingId) {
      continue;
    }
    try {
      await releaseBooking(env.DB, bookingId, "EXPIRED");
    } catch (e) {
      console.error("Failed to expire booking", bookingId, e);
    }
  }
}
__name(handleScheduled, "handleScheduled");

// src/index.ts
var src_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    };
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders
      });
    }
    let response;
    try {
      if (url.pathname === "/auth") {
        response = await handleAuth(request, env);
      } else if (url.pathname === "/auth/callback") {
        response = await handleAuthCallback(request, env);
      } else if (url.pathname.startsWith("/webhooks")) {
        response = await handleWebhook(request, env);
      } else if (url.pathname.startsWith("/proxy")) {
        response = await handleProxyRequest(request, env);
      } else if (url.pathname.startsWith("/admin")) {
        response = await handleAdminRequest(request, env);
      } else {
        response = new Response("Mexican Golf Cart Worker is Running");
      }
    } catch (e) {
      console.error("Worker Error:", e);
      response = new Response("Internal Server Error", { status: 500 });
    }
    const newHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      newHeaders.set(key, value);
    });
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(event, env));
  }
};

// ../../../.nvm/versions/node/v24.11.1/lib/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../.nvm/versions/node/v24.11.1/lib/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError2 = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError2;

// .wrangler/tmp/bundle-wLXFA7/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../../.nvm/versions/node/v24.11.1/lib/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-wLXFA7/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
