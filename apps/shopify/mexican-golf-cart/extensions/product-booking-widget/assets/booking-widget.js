/* global flatpickr, rangePlugin */
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

            // Always show 2 months side by side to match reference design
            const showMonths = 2;

            // Store pending dates before confirmation
            let pendingDates = [];

            // Helper: Calculate days between two dates
            const calculateDays = (startDate, endDate) => {
                if (!startDate || !endDate) return 0;
                const diffTime = Math.abs(endDate - startDate);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                return diffDays;
            };

            // Helper: Update footer day count
            const updateFooterDays = (instance, selectedDates) => {
                const footer = instance.calendarContainer?.querySelector('.mgc-calendar-footer');
                if (!footer) return;

                const daysEl = footer.querySelector('.mgc-calendar-footer__days');
                const doneBtn = footer.querySelector('.mgc-calendar-footer__btn--done');

                if (selectedDates.length === 2) {
                    const days = calculateDays(selectedDates[0], selectedDates[1]);
                    daysEl.textContent = `${days} day${days !== 1 ? 's' : ''}`;
                    doneBtn.disabled = false;
                    doneBtn.style.opacity = '1';
                } else if (selectedDates.length === 1) {
                    daysEl.textContent = 'Select end date';
                    doneBtn.disabled = true;
                    doneBtn.style.opacity = '0.5';
                } else {
                    daysEl.textContent = 'Select dates';
                    doneBtn.disabled = true;
                    doneBtn.style.opacity = '0.5';
                }
            };

            // Helper: Create and inject footer
            const injectFooter = (instance) => {
                if (!instance.calendarContainer) return;

                // Check if footer already exists
                if (instance.calendarContainer.querySelector('.mgc-calendar-footer')) return;

                const footer = document.createElement('div');
                footer.className = 'mgc-calendar-footer';
                footer.innerHTML = `
                    <span class="mgc-calendar-footer__days">Select dates</span>
                    <div class="mgc-calendar-footer__actions">
                        <button type="button" class="mgc-calendar-footer__btn mgc-calendar-footer__btn--cancel">Cancel</button>
                        <button type="button" class="mgc-calendar-footer__btn mgc-calendar-footer__btn--done" disabled style="opacity: 0.5">Done</button>
                    </div>
                `;

                instance.calendarContainer.appendChild(footer);

                // Cancel button handler
                footer.querySelector('.mgc-calendar-footer__btn--cancel').addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    pendingDates = [];
                    instance.close();
                });

                // Done button handler
                footer.querySelector('.mgc-calendar-footer__btn--done').addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (pendingDates.length === 2) {
                        // Confirm the selection
                        validateDates();
                        debouncedCheckAvailability();
                        instance.close();
                    }
                });
            };

            // Custom locale for 2-letter weekday abbreviations (matching reference design)
            const customLocale = {
                firstDayOfWeek: 1, // Start week on Monday
                weekdays: {
                    shorthand: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
                    longhand: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
                },
                months: {
                    shorthand: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
                    longhand: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
                }
            };

            const pickerConfig = {
                mode: 'range',
                disableMobile: true,
                showMonths: showMonths,
                minDate: "today",
                dateFormat: "Y-m-d",
                altInput: true,
                altFormat: "M j, Y",
                closeOnSelect: false, // Keep open until Done is clicked
                locale: customLocale,

                plugins: [new rangePlugin({ input: elements.end })],

                onReady: function (selectedDates, dateStr, instance) {
                    // Inject custom footer
                    injectFooter(instance);

                    // Add showMonths class for CSS targeting
                    if (showMonths === 2) {
                        instance.calendarContainer.classList.add('showMonths2');
                    }
                },

                onOpen: function (selectedDates, dateStr, instance) {
                    if (instance.calendarContainer) {
                        // Ensure footer exists
                        injectFooter(instance);

                        // Update footer state based on current selection
                        pendingDates = [...selectedDates];
                        updateFooterDays(instance, selectedDates);

                        // Add class for styling hooks
                        instance.calendarContainer.classList.add('mgc-custom-calendar');
                    }
                },

                onChange: function (selectedDates, dateStr, instance) {
                    // Store pending dates
                    pendingDates = [...selectedDates];

                    // Update footer day count
                    updateFooterDays(instance, selectedDates);

                    // Constraint: Minimum 1 day range (Start != End)
                    if (selectedDates.length === 2) {
                        const start = selectedDates[0];
                        const end = selectedDates[1];

                        if (start.getTime() === end.getTime()) {
                            // Same day selected - reset to just start date
                            instance.setDate([start], false);
                            pendingDates = [start];
                            updateFooterDays(instance, [start]);
                        }
                    }
                },

                onClose: function (selectedDates, dateStr, instance) {
                    // If user closed without clicking Done, and we have confirmed dates, keep them
                    // No additional action needed - Flatpickr maintains the last valid selection
                    if (selectedDates.length === 2) {
                        validateDates();
                        debouncedCheckAvailability();
                    }
                }
            };

            // Initialize on Start Input
            elements.startPicker = flatpickr(elements.start, pickerConfig);

            // Dynamic Resizing support
            window.addEventListener('resize', () => {
                if (elements.startPicker && elements.startPicker.isOpen) {
                    elements.startPicker.redraw();
                }
            });
        }

        function handleAbandon() {
            if (currentBookingToken) {
                const blob = new Blob([JSON.stringify({ booking_token: currentBookingToken })], { type: 'application/json' });
                navigator.sendBeacon(`${API_BASE}/release?shop=${shopDomain}`, blob);
            }
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
