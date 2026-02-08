/* global flatpickr, rangePlugin */
document.addEventListener('DOMContentLoaded', () => {
    const forms = document.querySelectorAll('.gc-booking-form');
    const DEBOUNCE_DELAY = 500;
    const HOLD_MINUTES = 20;

    forms.forEach((form) => {
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
            errorState: document.querySelector('.gc-error-state'),
            fulfillmentRadios: form.querySelectorAll('input[name="fulfillment_type"]'),
            fulfillmentSelect: form.querySelector('.gc-fulfillment-select'),
            pickupDetails: form.querySelector('.gc-pickup-details'),
            deliveryDetails: form.querySelector('.gc-delivery-details'),
            deliveryAddress: form.querySelector('[name="delivery_address"]'),
            addressText: form.querySelector('.gc-address-text'),
            toggleContainer: form.querySelector('.gc-product-toggle-container'),
            toggle: form.querySelector('.gc-product-toggle'),
            toggleSelect: form.querySelector('.gc-product-toggle-select'),
        };

        const grid = form.closest('.gc-grid-container');
        elements.productImageContainer = grid ? grid.querySelector('[data-gc-product-image-container]') : null;
        elements.productImage = elements.productImageContainer
            ? elements.productImageContainer.querySelector('[data-gc-product-image]')
            : null;
        elements.productImagePlaceholder = elements.productImageContainer
            ? elements.productImageContainer.querySelector('[data-gc-product-image-placeholder]')
            : null;

        const initialProductId = parsePositiveInt(form.dataset.productId);
        const initialVariantId = parsePositiveInt(form.dataset.variantId);
        const pageContext = String(form.dataset.pageContext || '').toLowerCase();
        const isProductPage = pageContext === 'product';

        let runtimeLocations = [];
        let runtimeProducts = [];
        let runtimeFeaturedProducts = [];
        let selectedProduct = null;
        let debounceTimer = null;
        let countdownInterval = null;
        let currentBookingToken = null;
        let configLoadAttempt = 0;

        const shopDomain = elements.container?.dataset.shopDomain || '';
        const API_BASE = elements.container?.dataset.apiBase || '/apps/rental';

        if (!elements.start || !elements.end || !elements.location || !elements.quantity || !elements.submitBtn) {
            return;
        }
        if (!shopDomain) {
            showFatalError('Missing shop domain.');
            return;
        }

        init();

        function init() {
            initDatePickers();
            attachListeners();
            updateSubmitForConfigState();
            void loadRuntimeConfig();
            window.addEventListener('pagehide', handleAbandon);
        }

        async function loadRuntimeConfig() {
            configLoadAttempt += 1;
            updateStatus('Loading booking options...', 'loading');
            updateSubmitForConfigState('Loading options...');

            try {
                const response = await fetch(`${API_BASE}/config?shop=${encodeURIComponent(shopDomain)}`);
                if (!response.ok) {
                    throw new Error(`Config fetch failed (${response.status})`);
                }
                const data = await response.json();
                if (!data?.ok || !Array.isArray(data.locations)) {
                    throw new Error('Invalid config response');
                }

                const rentablePayload = Array.isArray(data.rentable_products)
                    ? data.rentable_products
                    : Array.isArray(data.products)
                        ? data.products
                        : [];
                const featuredIds = normalizeFeaturedProductIds(data.featured_products);

                runtimeLocations = normalizeLocations(data.locations);
                runtimeProducts = normalizeProducts(rentablePayload);
                runtimeFeaturedProducts = resolveFeaturedProducts(runtimeProducts, featuredIds);

                if (runtimeLocations.length === 0) {
                    throw new Error('No active locations configured');
                }
                if (runtimeProducts.length === 0) {
                    throw new Error('No rentable products configured');
                }

                renderLocations(runtimeLocations);
                renderProducts(runtimeFeaturedProducts);
                updateStatus('');
                updateSubmitForConfigState();
                debouncedCheckAvailability();
            } catch (error) {
                console.error('Failed to load booking config', error);
                const canRetry = configLoadAttempt < 3;
                const message = canRetry
                    ? 'Unable to load booking configuration. Please retry.'
                    : 'Booking configuration is unavailable.';
                updateStatus(message, 'error');
                updateSubmitForConfigState('Retry configuration');
                if (!canRetry) {
                    showFatalError(message);
                }
            }
        }

        function normalizeLocations(locations) {
            return locations
                .filter((entry) => entry && typeof entry.code === 'string' && typeof entry.name === 'string')
                .map((entry) => ({
                    code: entry.code.trim(),
                    name: entry.name.trim(),
                }))
                .filter((entry) => entry.code.length > 0 && entry.name.length > 0);
        }

        function normalizeProducts(products) {
            return products
                .map((entry) => {
                    const productId = parsePositiveInt(entry.product_id);
                    const variantId = parsePositiveInt(entry.variant_id);
                    if (!productId || !variantId) {
                        return null;
                    }

                    const depositVariantId = parsePositiveInt(entry.deposit_variant_id);
                    const multiplierRaw = Number(entry.deposit_multiplier);
                    const depositMultiplier =
                        Number.isInteger(multiplierRaw) && multiplierRaw > 0 ? multiplierRaw : 1;

                    return {
                        product_id: productId,
                        variant_id: variantId,
                        title: String(entry.title || `Product ${productId}`),
                        image_url: entry.image_url ? String(entry.image_url) : '',
                        image_alt: entry.image_alt ? String(entry.image_alt) : '',
                        default_capacity: Number(entry.default_capacity || 0),
                        deposit_variant_id: depositVariantId,
                        deposit_multiplier: depositMultiplier,
                    };
                })
                .filter((entry) => entry !== null);
        }

        function normalizeFeaturedProductIds(featuredProducts) {
            if (!Array.isArray(featuredProducts)) {
                return [];
            }

            const seen = new Set();
            const ids = [];
            featuredProducts.forEach((entry) => {
                const productId = parsePositiveInt(entry?.product_id);
                if (!productId || seen.has(productId)) {
                    return;
                }
                seen.add(productId);
                ids.push(productId);
            });

            return ids.slice(0, 3);
        }

        function resolveFeaturedProducts(rentableProducts, featuredIds) {
            if (!Array.isArray(rentableProducts) || rentableProducts.length === 0) {
                return [];
            }

            const rentableById = new Map(
                rentableProducts.map((entry) => [entry.product_id, entry])
            );

            const configured = featuredIds
                .map((productId) => rentableById.get(productId))
                .filter((entry) => entry);
            if (configured.length > 0) {
                return configured.slice(0, 3);
            }

            return rentableProducts.slice(0, 3);
        }

        function renderLocations(locations) {
            elements.location.innerHTML = '<option value="" disabled selected>Select a location</option>';
            locations.forEach((location) => {
                const option = document.createElement('option');
                option.value = location.code;
                option.textContent = location.name;
                elements.location.appendChild(option);
            });
            updateAddressDisplay();
        }

        function renderProducts(products) {
            if (!isProductPage && elements.toggleContainer && elements.toggle) {
                elements.toggleContainer.style.display = 'block';
                elements.toggle.innerHTML = '';

                if (elements.toggleSelect) {
                    elements.toggleSelect.innerHTML = '';
                }

                products.forEach((product) => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'gc-toggle-option';
                    button.dataset.productId = String(product.product_id);
                    button.textContent = product.title;
                    button.onclick = () => selectProduct(product, button);
                    elements.toggle.appendChild(button);

                    if (elements.toggleSelect) {
                        const option = document.createElement('option');
                        option.value = String(product.product_id);
                        option.textContent = product.title;
                        elements.toggleSelect.appendChild(option);
                    }
                });
            }

            const desiredProduct = isProductPage
                ? (initialProductId && runtimeProducts.find((p) => p.product_id === initialProductId))
                : ((initialProductId && products.find((p) => p.product_id === initialProductId)) || products[0]);
            if (!desiredProduct) {
                updateStatus('No rentable products are configured.', 'error');
                updateSubmitForConfigState();
                return;
            }

            if (isProductPage && initialProductId && desiredProduct.product_id !== initialProductId) {
                updateStatus('This product is not configured for rentals.', 'error');
                updateSubmitForConfigState();
                return;
            }

            const preferredVariantMatches =
                initialVariantId && desiredProduct.variant_id === initialVariantId;
            if (!preferredVariantMatches && isProductPage && initialVariantId && configLoadAttempt === 1) {
                console.warn('Product variant from Liquid does not match runtime config variant', {
                    initialVariantId,
                    configuredVariantId: desiredProduct.variant_id,
                });
            }

            selectProduct(desiredProduct);
        }

        function selectProduct(product, explicitButton) {
            selectedProduct = product;

            if (!isProductPage && elements.toggle) {
                const buttons = elements.toggle.querySelectorAll('.gc-toggle-option');
                buttons.forEach((button) => button.classList.remove('active'));
                const targetButton =
                    explicitButton
                    || elements.toggle.querySelector(`.gc-toggle-option[data-product-id="${String(product.product_id)}"]`);
                if (targetButton) {
                    targetButton.classList.add('active');
                }
            }

            if (!isProductPage && elements.toggleSelect) {
                elements.toggleSelect.value = String(product.product_id);
            }

            renderProductImage(product);
            updateSubmitForConfigState();
            debouncedCheckAvailability();
        }

        function renderProductImage(product) {
            if (!elements.productImageContainer || !elements.productImage) {
                return;
            }

            const imageUrl = product?.image_url ? String(product.image_url) : '';
            const title = product?.title ? String(product.title) : 'Product';
            const altText = product?.image_alt ? String(product.image_alt) : `Rental – ${title}`;

            if (imageUrl) {
                elements.productImage.src = imageUrl;
                elements.productImage.alt = altText;
                elements.productImage.style.display = 'block';
                if (elements.productImagePlaceholder) {
                    elements.productImagePlaceholder.style.display = 'none';
                }
                elements.productImageContainer.classList.add('gc-product-image--has-image');
                return;
            }

            elements.productImage.removeAttribute('src');
            elements.productImage.alt = '';
            elements.productImage.style.display = 'none';
            if (elements.productImagePlaceholder) {
                elements.productImagePlaceholder.style.display = 'flex';
            }
            elements.productImageContainer.classList.remove('gc-product-image--has-image');
        }

        function showFatalError(message) {
            updateStatus(message, 'error');
            if (elements.errorState) {
                elements.errorState.style.display = 'block';
                form.style.display = 'none';
            }
        }

        function initDatePickers() {
            if (typeof flatpickr === 'undefined') {
                return;
            }

            flatpickr(elements.start, {
                mode: 'range',
                altInput: true,
                altFormat: 'M j, Y',
                dateFormat: 'Y-m-d',
                minDate: 'today',
                plugins: [new rangePlugin({ input: elements.end })],
                onChange(selectedDates, _dateStr, instance) {
                    if (selectedDates.length === 2) {
                        elements.start.value = instance.formatDate(selectedDates[0], 'Y-m-d');
                        elements.end.value = instance.formatDate(selectedDates[1], 'Y-m-d');
                        elements.start.dispatchEvent(new Event('change'));
                        elements.end.dispatchEvent(new Event('change'));
                    }
                },
                onReady() {
                    elements.end.readOnly = true;
                },
            });
        }

        function attachListeners() {
            const inputs = [elements.start, elements.end, elements.location, elements.quantity];
            inputs.forEach((input) => {
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

            if (elements.qtyMinus && elements.qtyPlus && elements.quantity) {
                const updateQuantity = (delta) => {
                    const current = parseInt(elements.quantity.value || '1', 10);
                    const min = parseInt(elements.quantity.min || '1', 10);
                    const max = parseInt(elements.quantity.max || '10', 10);
                    let next = current + delta;
                    if (next < min) next = min;
                    if (next > max) next = max;
                    if (next !== current) {
                        elements.quantity.value = String(next);
                        elements.quantity.dispatchEvent(new Event('change'));
                    }
                };

                elements.qtyMinus.addEventListener('click', (event) => {
                    event.preventDefault();
                    updateQuantity(-1);
                });
                elements.qtyPlus.addEventListener('click', (event) => {
                    event.preventDefault();
                    updateQuantity(1);
                });
            }

            if (elements.toggleSelect) {
                elements.toggleSelect.addEventListener('change', () => {
                    const productId = parsePositiveInt(elements.toggleSelect.value);
                    if (!productId) {
                        return;
                    }
                    const next = runtimeFeaturedProducts.find((product) => product.product_id === productId);
                    if (next) {
                        selectProduct(next);
                    }
                });
            }

            const applyFulfillmentSelection = (value) => {
                const isPickup = value === 'pickup';
                if (elements.pickupDetails) {
                    elements.pickupDetails.style.display = isPickup ? 'block' : 'none';
                }
                if (elements.deliveryDetails) {
                    elements.deliveryDetails.style.display = isPickup ? 'none' : 'block';
                }
                if (elements.deliveryAddress) {
                    elements.deliveryAddress.required = !isPickup;
                }
            };

            if (elements.fulfillmentRadios.length) {
                elements.fulfillmentRadios.forEach((radio) => {
                    radio.addEventListener('change', (event) => {
                        const selectedValue = event.target.value;
                        if (elements.fulfillmentSelect) {
                            elements.fulfillmentSelect.value = selectedValue;
                        }
                        applyFulfillmentSelection(selectedValue);
                    });
                });
            }

            if (elements.fulfillmentSelect) {
                elements.fulfillmentSelect.addEventListener('change', (event) => {
                    const selectedValue = event.target.value;
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

            elements.location.addEventListener('change', updateAddressDisplay);
            form.addEventListener('submit', handleSubmit);
        }

        function updateAddressDisplay() {
            if (!elements.addressText) {
                return;
            }
            const selectedOption = elements.location.options[elements.location.selectedIndex];
            if (selectedOption && selectedOption.value) {
                elements.addressText.textContent = `Pickup at: ${selectedOption.textContent}`;
            } else {
                elements.addressText.textContent = 'Pick-up my cart at The Dock Sayulita';
            }
        }

        function validateDates() {
            if (elements.start.value && elements.end.value && elements.start.value === elements.end.value) {
                updateStatus('Minimum booking is 1 night (return next day)', 'error');
                elements.submitBtn.disabled = true;
            }
        }

        function debouncedCheckAvailability() {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                void checkAvailability();
            }, DEBOUNCE_DELAY);
        }

        async function ensureConfigReadyForSubmit() {
            if (selectedProduct && selectedProduct.variant_id) {
                return true;
            }
            await loadRuntimeConfig();
            return Boolean(selectedProduct && selectedProduct.variant_id);
        }

        async function checkAvailability() {
            if (!selectedProduct || !selectedProduct.variant_id) {
                updateStatus('Select a configured rentable product.', 'error');
                updateSubmitForConfigState();
                return;
            }
            if (!elements.start.value || !elements.end.value || !elements.location.value || !elements.quantity.value) {
                updateStatus('');
                return;
            }

            updateStatus('Checking availability...', 'loading');
            try {
                const params = new URLSearchParams({
                    product_id: String(selectedProduct.product_id),
                    start_date: elements.start.value,
                    end_date: elements.end.value,
                    location: elements.location.value,
                    quantity: elements.quantity.value,
                    shop: shopDomain,
                });
                const response = await fetch(`${API_BASE}/availability?${params.toString()}`);
                if (!response.ok) {
                    const errorPayload = await response.json().catch(() => ({}));
                    throw new Error(errorPayload.error || `Availability failed (${response.status})`);
                }
                const payload = await response.json();
                if (payload.available) {
                    updateStatus('Available', 'success');
                    elements.submitBtn.disabled = false;
                    elements.submitBtn.textContent = 'Reserve Now';
                } else {
                    updateStatus(payload.error || 'Unavailable for selected dates', 'error');
                    elements.submitBtn.disabled = true;
                }
            } catch (error) {
                console.error(error);
                updateStatus('Error checking availability. Please retry.', 'error');
                updateSubmitForConfigState('Retry availability');
            }
        }

        async function handleSubmit(event) {
            event.preventDefault();

            const isReady = await ensureConfigReadyForSubmit();
            if (!isReady || !selectedProduct) {
                updateStatus('Product configuration is unavailable. Please retry.', 'error');
                updateSubmitForConfigState('Retry configuration');
                return;
            }

            updateStatus('Processing...', 'loading');
            elements.submitBtn.disabled = true;

            try {
                const quantity = parseInt(elements.quantity.value, 10);
                if (!Number.isInteger(quantity) || quantity <= 0) {
                    throw new Error('Invalid quantity');
                }

                const holdResponse = await fetch(`${API_BASE}/hold?shop=${encodeURIComponent(shopDomain)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        start_date: elements.start.value,
                        end_date: elements.end.value,
                        location: elements.location.value,
                        items: [
                            {
                                product_id: selectedProduct.product_id,
                                variant_id: selectedProduct.variant_id,
                                qty: quantity,
                            },
                        ],
                    }),
                });
                const holdData = await holdResponse.json().catch(() => null);
                if (!holdResponse.ok || !holdData?.booking_token) {
                    throw new Error(holdData?.error || 'Failed to reserve booking');
                }

                currentBookingToken = holdData.booking_token;
                if (holdData.expires_at) {
                    startCountdown(holdData.expires_at);
                }

                const selectedFulfillment = form.querySelector('input[name="fulfillment_type"]:checked');
                const fulfillmentRaw = selectedFulfillment ? selectedFulfillment.value : 'pickup';
                const fulfillmentLabel = fulfillmentRaw === 'pickup' ? 'Pick Up' : 'Delivery';
                const bookingProperties = {
                    booking_token: holdData.booking_token,
                    'Start Date': elements.start.value,
                    'End Date': elements.end.value,
                    Location: elements.location.options[elements.location.selectedIndex]?.text || elements.location.value,
                    'Location Code': elements.location.value,
                    'Fulfillment Type': fulfillmentLabel,
                    ...(fulfillmentRaw === 'delivery' && elements.deliveryAddress?.value
                        ? { 'Delivery Address': elements.deliveryAddress.value }
                        : {}),
                };

                const cartItems = [
                    {
                        id: selectedProduct.variant_id,
                        quantity,
                        properties: bookingProperties,
                    },
                ];

                if (selectedProduct.deposit_variant_id) {
                    cartItems.push({
                        id: selectedProduct.deposit_variant_id,
                        quantity: quantity * selectedProduct.deposit_multiplier,
                        properties: {
                            ...bookingProperties,
                            'Line Item Type': 'Deposit',
                        },
                    });
                }

                const cartResponse = await fetch('/cart/add.js', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ items: cartItems }),
                });
                if (!cartResponse.ok) {
                    throw new Error('Failed to add booking to cart');
                }

                currentBookingToken = null;
                window.location.href = '/cart';
            } catch (error) {
                console.error(error);
                updateStatus(error instanceof Error ? error.message : 'Failed to create booking', 'error');
                elements.submitBtn.disabled = false;
                elements.submitBtn.textContent = 'Retry Add to Cart';
            }
        }

        function handleAbandon() {
            if (!currentBookingToken) {
                return;
            }
            const payload = JSON.stringify({ booking_token: currentBookingToken });
            const blob = new Blob([payload], { type: 'application/json' });
            navigator.sendBeacon(`${API_BASE}/release?shop=${encodeURIComponent(shopDomain)}`, blob);
        }

        function startCountdown(expiresAtIso) {
            if (countdownInterval) {
                clearInterval(countdownInterval);
            }

            const expiresAt = new Date(expiresAtIso).getTime();
            if (elements.timerContainer) {
                elements.timerContainer.style.display = 'flex';
            }

            const updateTimer = () => {
                const remainingMs = expiresAt - Date.now();
                if (remainingMs <= 0) {
                    clearInterval(countdownInterval);
                    if (elements.timerText) {
                        elements.timerText.textContent = 'Reservation Expired';
                    }
                    handleExpiry();
                    return;
                }

                const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((remainingMs % (1000 * 60)) / 1000);
                if (elements.timerText) {
                    elements.timerText.textContent = `Held for ${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
                }
            };

            updateTimer();
            countdownInterval = setInterval(updateTimer, 1000);
        }

        function handleExpiry() {
            updateStatus('Reservation expired. Please refresh.', 'error');
            elements.submitBtn.disabled = true;
            elements.submitBtn.textContent = 'Expired';
            currentBookingToken = null;

            const refreshLink = document.createElement('a');
            refreshLink.href = '#';
            refreshLink.textContent = 'Refresh to try again';
            refreshLink.style.display = 'block';
            refreshLink.style.textAlign = 'center';
            refreshLink.style.marginTop = '10px';
            refreshLink.onclick = (event) => {
                event.preventDefault();
                window.location.reload();
            };
            elements.statusMsg.appendChild(refreshLink);
        }

        function updateSubmitForConfigState(buttonLabel) {
            const configReady = Boolean(selectedProduct && selectedProduct.variant_id && runtimeProducts.length > 0);
            if (!configReady) {
                const canRetry = typeof buttonLabel === 'string' && buttonLabel.toLowerCase().includes('retry');
                elements.submitBtn.disabled = !canRetry;
                elements.submitBtn.textContent = buttonLabel || 'Loading...';
                return;
            }
            elements.submitBtn.textContent = buttonLabel || `Reserve for ${HOLD_MINUTES} min`;
        }

        function updateStatus(message, type = 'info') {
            elements.statusMsg.innerHTML = '';
            elements.statusMsg.className = 'gc-status-message';

            if (type === 'error' && message) {
                elements.statusMsg.textContent = message;
                elements.statusMsg.classList.add('gc-status-error');
            }
        }
    });
});

function parsePositiveInt(value) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return null;
    }
    return parsed;
}
