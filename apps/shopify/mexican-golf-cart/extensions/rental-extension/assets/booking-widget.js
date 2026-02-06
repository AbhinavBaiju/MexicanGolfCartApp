/* global flatpickr, rangePlugin */
document.addEventListener('DOMContentLoaded', () => {
    const forms = document.querySelectorAll('.gc-booking-form');

    // ============================================
    // STATIC CONFIGURATION (Hardcoded for Performance)
    // This widget is single-store only - no dynamic config needed
    // ============================================
    const STATIC_LOCATIONS = [
        { code: 'la_cruz', name: 'La Cruz' },
        { code: 'punta_mita', name: 'Punta Mita' },
        { code: 'san_pancho', name: 'San Pancho' },
        { code: 'sayulita', name: 'Sayulita' }
    ];

    const STATIC_PRODUCTS = [
        { title: 'Golf Cart', product_id: 7841859010662, variant_id: null, image_url: null, image_alt: null },
        { title: 'Polaris Ranger', product_id: 7841859141734, variant_id: null, image_url: null, image_alt: null },
        { title: "6' Soft Top Longboard", product_id: 7841859240038, variant_id: 44340215840870, image_url: null, image_alt: null }
    ];

    // Configuration
    const DEBOUNCE_DELAY = 500;

    forms.forEach(form => {
        const elements = {
            start: form.querySelector('[name="booking_start_date"]'),
            end: form.querySelector('[name="booking_end_date"]'),
            location: form.querySelector('[name="booking_location"]'),
            quantity: form.querySelector('[name="booking_quantity"]'),
            qtyMinus: form.querySelector('.gc-qty-minus'),
            qtyPlus: form.querySelector('.gc-qty-plus'),
            submitBtn: form.querySelector('.gc-submit-btn'),
            statusMsg: form.querySelector('.gc-status-message'),
            container: form.closest('.booking-container'),
            timerContainer: form.querySelector('#gc-timer-container'),
            timerText: form.querySelector('#gc-timer-text'),
            errorState: document.querySelector('.gc-error-state'), // Global or scoped if inside widget

            // New Elements
            fulfillmentRadios: form.querySelectorAll('input[name="fulfillment_type"]'),
            fulfillmentSelect: form.querySelector('.gc-fulfillment-select'),
            pickupDetails: form.querySelector('.gc-pickup-details'),
            deliveryDetails: form.querySelector('.gc-delivery-details'),
            deliveryAddress: form.querySelector('[name="delivery_address"]'),
            addressText: form.querySelector('.gc-address-text')
        };

        let productId = form.dataset.productId;
        let variantId = form.dataset.variantId;

        let visibleProducts = [];
        let debounceTimer = null;
        let countdownInterval = null;
        let currentBookingToken = null;
        const shopDomain = elements.container.dataset.shopDomain;
        const API_BASE = elements.container.dataset.apiBase || '/apps/rental'; // Fallback

        // Initialize
        // if (!elements.location) return; // Allow running even if location is loading
        init();

        function init() {
            // Select new elements
            elements.toggleContainer = form.querySelector('.gc-product-toggle-container');
            elements.toggle = form.querySelector('.gc-product-toggle');
            elements.toggleSelect = form.querySelector('.gc-product-toggle-select');
            const grid = form.closest('.gc-grid-container');
            elements.productImageContainer = grid ? grid.querySelector('[data-gc-product-image-container]') : null;
            elements.productImage = elements.productImageContainer ? elements.productImageContainer.querySelector('[data-gc-product-image]') : null;
            elements.productImagePlaceholder = elements.productImageContainer ? elements.productImageContainer.querySelector('[data-gc-product-image-placeholder]') : null;

            initDatePickers();
            initStaticConfig();  // Instant UI setup with hardcoded data
            fetchVariantIds();   // Background fetch for variant_ids only
            attachListeners();

            // Release on abandon
            window.addEventListener('pagehide', handleAbandon);

            if (elements.toggleSelect) {
                elements.toggleSelect.addEventListener('change', () => {
                    const nextId = String(elements.toggleSelect.value || '');
                    const nextProd = visibleProducts.find(p => String(p.product_id) === nextId);
                    if (!nextProd) return;
                    selectProduct(nextProd);
                });
            }
        }

        // Initialize Flatpickr date pickers with range selection
        function initDatePickers() {
            if (typeof flatpickr === 'undefined') {
                console.error('Flatpickr library not loaded');
                return;
            }

            // Initialize range picker on start date input
            flatpickr(elements.start, {
                mode: "range",
                altInput: true,
                altFormat: "M j, Y",
                dateFormat: "Y-m-d",
                minDate: "today",
                plugins: [new rangePlugin({ input: elements.end })],
                onChange: function (selectedDates, dateStr, instance) {
                    if (selectedDates.length === 2) {
                        elements.start.value = instance.formatDate(selectedDates[0], "Y-m-d");
                        elements.end.value = instance.formatDate(selectedDates[1], "Y-m-d");
                        // Trigger change events to update availability
                        elements.start.dispatchEvent(new Event('change'));
                        elements.end.dispatchEvent(new Event('change'));
                    }
                },
                onReady: function () {
                    // Mark end input as readonly since it's controlled by range plugin
                    if (elements.end) {
                        elements.end.readOnly = true;
                    }
                }
            });
        }

        function handleAbandon() {
            if (currentBookingToken) {
                const blob = new Blob([JSON.stringify({ booking_token: currentBookingToken })], { type: 'application/json' });
                navigator.sendBeacon(`${API_BASE}/release?shop=${shopDomain}`, blob);
            }
        }

        // Initialize with hardcoded static config for instant UI
        function initStaticConfig() {
            // Populate locations immediately (no network request)
            elements.location.innerHTML = '<option value="" disabled selected>Select a location</option>';
            STATIC_LOCATIONS.forEach(loc => {
                const option = document.createElement('option');
                option.value = loc.code;
                option.textContent = loc.name;
                elements.location.appendChild(option);
            });
            if (updateAddressDisplay) updateAddressDisplay();

            // Render product toggle immediately
            renderProductToggle(STATIC_PRODUCTS);
        }

        // Background fetch for variant_ids only (needed for booking submission)
        async function fetchVariantIds() {
            try {
                const res = await fetch(`${API_BASE}/config?shop=${shopDomain}`);
                if (!res.ok) return; // Silent fail - UI already working

                const data = await res.json();
                const products = data.products || [];

                // Update STATIC_PRODUCTS with fetched variant_ids + images (if available)
                products.forEach(serverProd => {
                    const staticProd = STATIC_PRODUCTS.find(p => p.product_id === serverProd.product_id);
                    if (staticProd && serverProd.variant_id) {
                        staticProd.variant_id = serverProd.variant_id;
                    }
                    if (staticProd && serverProd.image_url) {
                        staticProd.image_url = serverProd.image_url;
                        staticProd.image_alt = serverProd.image_alt || null;
                    }
                });

                // If current selected product now has variant_id, update it
                const currentProd = STATIC_PRODUCTS.find(p => p.product_id == productId);
                if (currentProd && currentProd.variant_id) {
                    variantId = currentProd.variant_id;
                }
                if (currentProd) {
                    renderProductImage(currentProd);
                }
            } catch (err) {
                console.warn('Background variant fetch failed:', err);
                // Widget still functional - just variant_ids may be incomplete
            }
        }

        function renderProductImage(prod) {
            if (!elements.productImageContainer || !elements.productImage) return;

            const url = prod && prod.image_url ? String(prod.image_url) : '';
            const title = prod && prod.title ? String(prod.title) : 'Product';
            const alt = prod && prod.image_alt ? String(prod.image_alt) : `Rental – ${title}`;

            if (url) {
                elements.productImage.src = url;
                elements.productImage.alt = alt;
                elements.productImage.style.display = 'block';
                if (elements.productImagePlaceholder) elements.productImagePlaceholder.style.display = 'none';
                elements.productImageContainer.classList.add('gc-product-image--has-image');
            } else {
                elements.productImage.removeAttribute('src');
                elements.productImage.alt = '';
                elements.productImage.style.display = 'none';
                if (elements.productImagePlaceholder) elements.productImagePlaceholder.style.display = 'flex';
                elements.productImageContainer.classList.remove('gc-product-image--has-image');
            }
        }

        function renderProductToggle(sourceProducts) {
            if (!elements.toggleContainer || !elements.toggle) return;

            // Enforce limit of 3 products
            const products = sourceProducts.slice(0, 3);
            visibleProducts = products;

            elements.toggleContainer.style.display = 'block';
            elements.toggle.innerHTML = '';

            if (elements.toggleSelect) {
                elements.toggleSelect.innerHTML = '';
                products.forEach((prod) => {
                    const opt = document.createElement('option');
                    opt.value = String(prod.product_id);
                    opt.textContent = prod.title || `Product ${prod.product_id}`;
                    elements.toggleSelect.appendChild(opt);
                });
            }

            // Determine initial selection from the VISIBLE products
            let targetProd = products[0];
            if (productId) {
                // If the liquid-provided ID is in our visible list, use it
                const match = products.find(p => p.product_id == productId);
                if (match) targetProd = match;
            }

            let targetBtn = null;

            products.forEach((prod, idx) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'gc-toggle-option';
                btn.dataset.productId = String(prod.product_id);
                btn.textContent = prod.title || `Product ${prod.product_id}`;

                btn.onclick = () => {
                    selectProduct(prod, btn);
                };

                elements.toggle.appendChild(btn);

                if (prod === targetProd) {
                    targetBtn = btn;
                }
            });

            if (targetBtn && targetProd) {
                selectProduct(targetProd, targetBtn);
            }
        }

        function selectProduct(prod, btn) {
            productId = prod.product_id;
            variantId = prod.variant_id; // Ensure variant_id is used if available

            // UI Update
            const all = elements.toggle.querySelectorAll('.gc-toggle-option');
            all.forEach(b => b.classList.remove('active'));
            const targetBtn = btn || elements.toggle.querySelector(`.gc-toggle-option[data-product-id="${String(prod.product_id)}"]`);
            if (targetBtn) targetBtn.classList.add('active');

            if (elements.toggleSelect) {
                const nextValue = String(prod.product_id);
                if (String(elements.toggleSelect.value) !== nextValue) {
                    elements.toggleSelect.value = nextValue;
                }
            }

            renderProductImage(prod);
            debouncedCheckAvailability();
        }

        function showFatalError() {
            if (elements.errorState) {
                elements.errorState.style.display = 'block';
                form.style.display = 'none'; // Hide the form
            }
        }

        function attachListeners() {
            const inputs = [elements.start, elements.end, elements.location, elements.quantity];
            const applyFulfillmentSelection = (value) => {
                const isPickup = value === 'pickup';
                if (elements.pickupDetails) elements.pickupDetails.style.display = isPickup ? 'block' : 'none';
                if (elements.deliveryDetails) elements.deliveryDetails.style.display = isPickup ? 'none' : 'block';

                if (elements.deliveryAddress) {
                    elements.deliveryAddress.required = !isPickup;
                }
            };

            inputs.forEach(input => {
                if (!input) return;
                input.addEventListener('change', () => {
                    validateDates();
                    debouncedCheckAvailability();
                });
                input.addEventListener('input', () => {
                    if (input.type !== 'date' && input.tagName !== 'SELECT') {
                        debouncedCheckAvailability();
                    }
                });
            });

            // Quantity Stepper Logic
            if (elements.qtyMinus && elements.qtyPlus && elements.quantity) {
                const updateQuantity = (delta) => {
                    let current = parseInt(elements.quantity.value) || 0;
                    let min = parseInt(elements.quantity.min) || 1;
                    let max = parseInt(elements.quantity.max) || 10;

                    let next = current + delta;
                    if (next < min) next = min;
                    if (next > max) next = max;

                    if (next !== current) {
                        elements.quantity.value = next;
                        elements.quantity.dispatchEvent(new Event('change'));
                        elements.quantity.dispatchEvent(new Event('input'));
                    }
                };

                elements.qtyMinus.addEventListener('click', (e) => { e.preventDefault(); updateQuantity(-1); });
                elements.qtyPlus.addEventListener('click', (e) => { e.preventDefault(); updateQuantity(1); });
            }

            form.addEventListener('submit', handleSubmit);

            // Fulfillment Toggle
            if (elements.fulfillmentRadios.length) {
                elements.fulfillmentRadios.forEach(radio => {
                    radio.addEventListener('change', (e) => {
                        const selectedValue = e.target.value;
                        if (elements.fulfillmentSelect && elements.fulfillmentSelect.value !== selectedValue) {
                            elements.fulfillmentSelect.value = selectedValue;
                        }
                        applyFulfillmentSelection(selectedValue);
                    });
                });
            }

            if (elements.fulfillmentSelect) {
                elements.fulfillmentSelect.addEventListener('change', (e) => {
                    const selectedValue = e.target.value;
                    const matchingRadio = form.querySelector(`input[name="fulfillment_type"][value="${selectedValue}"]`);
                    if (matchingRadio) {
                        matchingRadio.checked = true;
                    }
                    applyFulfillmentSelection(selectedValue);
                });
            }

            const defaultFulfillment = form.querySelector('input[name="fulfillment_type"]:checked');
            if (defaultFulfillment) {
                if (elements.fulfillmentSelect) {
                    elements.fulfillmentSelect.value = defaultFulfillment.value;
                }
                applyFulfillmentSelection(defaultFulfillment.value);
            }

            // Update Address Display
            if (elements.location) {
                elements.location.addEventListener('change', () => {
                    updateAddressDisplay();
                });
            }
        }

        function updateAddressDisplay() {
            if (!elements.location || !elements.addressText) return;
            const selectedOption = elements.location.options[elements.location.selectedIndex];
            if (selectedOption && selectedOption.value) {
                // Determine address (mock/placeholder for now as it's not in DB)
                // If we had a map of code -> address, we'd use it here.
                // For now, use the name.
                elements.addressText.textContent = `Pickup at: ${selectedOption.textContent}`;
            } else {
                elements.addressText.textContent = 'Pick-up my cart at The Dock Sayulita';
            }
        }

        function validateDates() {
            // Validation Logic compatible with range picker
            if ((elements.start.value && elements.end.value) && (elements.start.value === elements.end.value)) {
                // Prevent same day - if somehow selected
                updateStatus('Minimum booking is 1 night (return next day)', 'error');
                elements.submitBtn.disabled = true;
            }
        }

        function debouncedCheckAvailability() {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(checkAvailability, DEBOUNCE_DELAY);
        }

        async function checkAvailability() {
            if (!productId) {
                // updateStatus('Configuration missing: Select product in editor', 'error');
                return;
            }

            if (!elements.start.value || !elements.end.value || !elements.quantity.value) {
                updateStatus('');
                return;
            }

            updateStatus('Checking availability...', 'loading');
            // Do not disable during check to allow editing, unless specific req.
            // User req: "Disable the Submit button if unavailable" -> implies enabled if available.

            try {
                const params = new URLSearchParams({
                    product_id: productId,
                    start_date: elements.start.value,
                    end_date: elements.end.value,
                    location: elements.location.value,
                    quantity: elements.quantity.value,
                    shop: shopDomain
                });

                const res = await fetch(`${API_BASE}/availability?${params}`);
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(errData.error || `Availability check failed (${res.status})`);
                }
                const data = await res.json();

                if (data.available) {
                    updateStatus('✅ Available', 'success');
                    elements.submitBtn.disabled = false;
                    elements.submitBtn.textContent = 'Reserve Now';
                } else {
                    const msg = data.error || '❌ Sold Out / Unavailable';
                    updateStatus(msg, 'error');
                    elements.submitBtn.disabled = true;
                }
            } catch (err) {
                console.error(err);
                updateStatus('Error checking availability. Please try again.', 'error');
                // Maybe keep button enabled to retry? Or disable?
                elements.submitBtn.disabled = false;
            }
        }

        async function handleSubmit(e) {
            e.preventDefault();

            // If we already have a hold token and it's valid, just try adding to cart again?
            // Simpler for now: always create new hold or assume fresh flow.

            updateStatus('Processing...', 'loading');
            elements.submitBtn.disabled = true;

            try {
                // 1. Create Hold
                const holdRes = await fetch(`${API_BASE}/hold?shop=${shopDomain}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        start_date: elements.start.value,
                        end_date: elements.end.value,
                        location: elements.location.value,
                        items: [{
                            product_id: parseInt(productId),
                            variant_id: parseInt(variantId),
                            qty: parseInt(elements.quantity.value)
                        }]
                    })
                });

                const holdData = await holdRes.json();

                if (!holdRes.ok || !holdData.booking_token) {
                    throw new Error(holdData.error || 'Failed to reserve booking');
                }

                currentBookingToken = holdData.booking_token;

                // Start timer
                if (holdData.expires_at) {
                    startCountdown(holdData.expires_at);
                }

                // 2. Add to Cart
                updateStatus('Adding to cart...', 'loading');
                const selectedFulfillment = form.querySelector('input[name="fulfillment_type"]:checked');
                const fulfillmentValue = selectedFulfillment ? selectedFulfillment.value : 'pickup';

                const cartRes = await fetch('/cart/add.js', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        items: [{
                            id: variantId,
                            quantity: parseInt(elements.quantity.value),
                            properties: {
                                'booking_token': holdData.booking_token,
                                'Start Date': elements.start.value,
                                'End Date': elements.end.value,
                                'Location': elements.location.options[elements.location.selectedIndex].text,
                                'Location Code': elements.location.value,
                                'Fulfillment Type': fulfillmentValue === 'pickup' ? 'Pick Up' : 'Drop Off (Delivery)',
                                ...(fulfillmentValue === 'delivery' && elements.deliveryAddress && elements.deliveryAddress.value
                                    ? { 'Delivery Address': elements.deliveryAddress.value }
                                    : {})
                            }
                        }]
                    })
                });

                if (!cartRes.ok) throw new Error('Failed to add to cart');

                // 3. Redirect
                // Clear token so we don't release on unload!
                currentBookingToken = null;
                window.location.href = '/cart';

            } catch (err) {
                console.error(err);
                updateStatus(err.message, 'error');
                // Start timer shows we have a hold but cart failed. 
                // Re-enable button to try again?
                elements.submitBtn.disabled = false;
                elements.submitBtn.textContent = 'Retry Add to Cart';
            }
        }

        function startCountdown(expiresAtIso) {
            if (countdownInterval) clearInterval(countdownInterval);

            const expires = new Date(expiresAtIso).getTime();
            if (elements.timerContainer) elements.timerContainer.style.display = 'flex';

            updateTimer();
            countdownInterval = setInterval(updateTimer, 1000);

            function updateTimer() {
                const now = new Date().getTime();
                const distance = expires - now;

                if (distance < 0) {
                    clearInterval(countdownInterval);
                    elements.timerText.textContent = "Reservation Expired";
                    handleExpiry();
                    return;
                }

                const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((distance % (1000 * 60)) / 1000);

                elements.timerText.textContent = `Held for ${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
            }
        }

        function handleExpiry() {
            updateStatus('Reservation expired. Please refresh.', 'error');
            elements.submitBtn.disabled = true;
            elements.submitBtn.textContent = 'Expired';
            currentBookingToken = null; // Expired on server likely

            // Offer refresh
            const refreshLink = document.createElement('a');
            refreshLink.href = '#';
            refreshLink.textContent = 'Refresh to try again';
            refreshLink.style.display = 'block';
            refreshLink.style.textAlign = 'center';
            refreshLink.style.marginTop = '10px';
            refreshLink.onclick = (e) => {
                e.preventDefault();
                location.reload();
            };
            elements.statusMsg.appendChild(refreshLink);
        }

        function updateStatus(msg, type = 'info') {
            // Log all status updates to console as debug messages
            if (msg) {
                console.debug(`[Booking Widget] ${msg} (${type})`);
            }

            // Clear previous UI content
            elements.statusMsg.innerHTML = '';
            elements.statusMsg.className = 'gc-status-message';

            // Only display errors in the UI. 
            // Success ('Available') and loading ('Checking...') states are now console-only.
            if (type === 'error' && msg) {
                elements.statusMsg.textContent = msg;
                elements.statusMsg.classList.add(`gc-status-${type}`);
            }
        }
    });
});
