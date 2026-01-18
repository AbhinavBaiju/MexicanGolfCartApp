document.addEventListener('DOMContentLoaded', () => {
    const forms = document.querySelectorAll('.gc-booking-form');

    // Configuration
    // const API_BASE = '/apps/rental'; // Removed in favor of direct
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
            pickupDetails: form.querySelector('.gc-pickup-details'),
            deliveryDetails: form.querySelector('.gc-delivery-details'),
            deliveryAddress: form.querySelector('[name="delivery_address"]'),
            addressText: form.querySelector('.gc-address-text')
        };

        const productId = form.dataset.productId;
        const variantId = form.dataset.variantId;

        let debounceTimer = null;
        let countdownInterval = null;
        let currentBookingToken = null;
        const shopDomain = elements.container.dataset.shopDomain;
        const API_BASE = elements.container.dataset.apiBase || '/apps/rental'; // Fallback

        // Initialize
        if (!elements.location) return;
        init();

        function init() {
            // setMinDates(); // Replaced by Flatpickr
            initDatePickers();
            fetchLocations();
            attachListeners();

            // Release on abandon
            window.addEventListener('pagehide', handleAbandon);
            // Also handle visibility change as backup? pagehide is better for unload.
        }

        function initDatePickers() {
            // Wait for Flatpickr and Plugin to load
            if (typeof flatpickr === 'undefined') {
                console.warn('Flatpickr not loaded');
                return;
            }

            // Ensure we have both inputs
            if (!elements.start || !elements.end) return;

            // Mark inputs as readonly effectively (handled by flatpickr, but good to be sure)
            elements.start.setAttribute('readonly', 'readonly');
            elements.end.setAttribute('readonly', 'readonly');

            // Unique ID for mapping if needed (not strictly necessary with direct el reference)
            // elements.end.id = 'booking_end_date';

            // Determine months based on container width
            const containerWidth = form.offsetWidth;
            const showMonths = (containerWidth > 620 && window.innerWidth >= 768) ? 2 : 1;

            const pickerConfig = {
                mode: 'range',
                disableMobile: true,
                showMonths: showMonths,
                minDate: "today",
                dateFormat: "Y-m-d",
                altInput: true,
                altFormat: "M j, Y",
                // Remove appendTo: form to fix positioning issues (renders in body by default)

                plugins: [new rangePlugin({ input: elements.end })],

                onOpen: function (selectedDates, dateStr, instance) {
                    if (instance.calendarContainer) {
                        // Align to the specific date-range container or the whole form?
                        // User request: "same width as the input boxes's vertical spacing (total)"
                        // This implies matching the .gc-date-range container width.
                        const targetContainer = form.querySelector('.gc-date-range') || form;

                        const updatePosition = () => {
                            if (!instance.calendarContainer) return;

                            const rect = targetContainer.getBoundingClientRect();
                            const docScrollTop = window.scrollY || document.documentElement.scrollTop;
                            const docScrollLeft = window.scrollX || document.documentElement.scrollLeft;

                            // Force exact width of the input group
                            instance.calendarContainer.style.width = `${rect.width}px`;

                            // Align perfectly with left edge
                            instance.calendarContainer.style.left = `${rect.left + docScrollLeft}px`;

                            // Ensure it's just below
                            // instance.calendarContainer.style.top = `${rect.bottom + docScrollTop + 10}px`; 
                            // Flatpickr handles top automatically usually, but we can enforce if needed.
                        };

                        updatePosition();

                        // Small delay to override any internal Flatpickr recalcs
                        requestAnimationFrame(updatePosition);

                        // Add class for styling hooks
                        instance.calendarContainer.classList.add('mgc-custom-calendar');
                    }
                },

                onValueUpdate: function (d, s, instance) {
                    // Keep aligned on value updates if needed
                    // if(instance.calendarContainer) { ... }
                },

                onValueUpdate: function (d, s, instance) {
                    // Keep aligned on value updates if needed
                    if (instance.calendarContainer) {
                        const currentFormRect = form.getBoundingClientRect();
                        const docScrollLeft = window.scrollX || document.documentElement.scrollLeft;
                        instance.calendarContainer.style.left = `${currentFormRect.left + docScrollLeft}px`;
                    }
                },

                onChange: function (selectedDates, dateStr, instance) {
                    // Constraint: Minimum 1 day range (Start != End)
                    if (selectedDates.length === 2) {
                        const start = selectedDates[0];
                        const end = selectedDates[1];

                        if (start.getTime() === end.getTime()) {
                            // If user picked the same day twice, clear/reset or just clear the end date?
                            // Flatpickr range mode often handles "click same day twice" as "unselect".
                            // But if they select range start==end, we want to forbid it.
                            // However, in range mode, usually you click once for start, mouseover defines range, click again for end.
                            // If you click the same date twice, it becomes a 1-day range.

                            // We will clear the selection if it's the same day to force re-selection or valid range.
                            // Or better: set the date to just start and keep picker open? 
                            // Unfortunately programmatic open inside onChange can be glitchy.

                            // Let's validate downstream first: debouncedCheckAvailability handles checks.
                            // If we enforce it here, we might annoy users.
                            // But user said: "not the same day". 

                            // Let's clear the end date if it matches start.
                            // Actually, with rangePlugin, dateStr is the range string "start to end" or similar in internal value?
                            // No, rangePlugin puts separate values in inputs.
                        }
                    }
                    validateDates(); // Our existing logic can check dates too
                    debouncedCheckAvailability();
                }
            };

            // Initialize on Start Input
            elements.startPicker = flatpickr(elements.start, pickerConfig);

            // Allow clicking end input to open the same picker
            // (RangePlugin usually handles this)

            // Dynamic Resizing support
            window.addEventListener('resize', () => {
                if (elements.startPicker && elements.startPicker.isOpen) {
                    elements.startPicker.redraw();
                    // Manually trigger our positioning logic if we extracted it, 
                    // or rely on flatpickr's redraw + our onOpen (which fires on redraw?) - No, redraw doesn't fire onOpen.
                    // We need to re-run the positioning logic.
                    const instance = elements.startPicker;
                    if (instance.calendarContainer) {
                        const targetContainer = form.querySelector('.gc-date-range') || form;
                        const rect = targetContainer.getBoundingClientRect();
                        const docScrollLeft = window.scrollX || document.documentElement.scrollLeft;
                        instance.calendarContainer.style.width = `${rect.width}px`;
                        instance.calendarContainer.style.left = `${rect.left + docScrollLeft}px`;
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

        function setMinDates() {
            const today = new Date().toISOString().split('T')[0];
            if (elements.start) elements.start.min = today;
            if (elements.end) elements.end.min = today;
        }

        async function fetchLocations() {
            try {
                const res = await fetch(`${API_BASE}/config?shop=${shopDomain}`);
                if (!res.ok) {
                    const txt = await res.text();
                    throw new Error(`Failed to load locations: ${res.status} ${txt}`);
                }
                const data = await res.json();

                if (data.locations && data.locations.length > 0) {
                    elements.location.innerHTML = '<option value="" disabled selected>Select a location</option>';
                    data.locations.forEach(loc => {
                        const option = document.createElement('option');
                        option.value = loc.code; // Use location code to match booking storage
                        option.textContent = loc.name;
                        elements.location.appendChild(option);
                    });
                    // Initial update of address display
                    if (updateAddressDisplay) updateAddressDisplay();
                } else {
                    showFatalError();
                }
            } catch (err) {
                console.error(err);
                showFatalError();
            }
        }

        function showFatalError() {
            if (elements.errorState) {
                elements.errorState.style.display = 'block';
                form.style.display = 'none'; // Hide the form
            }
        }

        function attachListeners() {
            const inputs = [elements.start, elements.end, elements.location, elements.quantity];

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
                        const isPickup = e.target.value === 'pickup';
                        if (elements.pickupDetails) elements.pickupDetails.style.display = isPickup ? 'block' : 'none';
                        if (elements.deliveryDetails) elements.deliveryDetails.style.display = isPickup ? 'none' : 'block';

                        // Toggle required
                        if (elements.deliveryAddress) {
                            elements.deliveryAddress.required = !isPickup;
                        }
                    });
                });
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
                elements.addressText.textContent = 'Select a location to see address';
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

            if (!elements.start.value || !elements.end.value || !elements.location.value || !elements.quantity.value) {
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
                                'Fulfillment Type': form.querySelector('input[name="fulfillment_type"]:checked').value === 'pickup' ? 'Pick Up' : 'Drop Off (Delivery)',
                                ...(form.querySelector('input[name="fulfillment_type"]:checked').value === 'delivery' && elements.deliveryAddress && elements.deliveryAddress.value
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
            elements.statusMsg.innerHTML = ''; // Clear content including links
            elements.statusMsg.textContent = msg;
            elements.statusMsg.className = 'gc-status-message';
            if (msg) {
                elements.statusMsg.classList.add(`gc-status-${type}`);
            }
        }
    });
});
