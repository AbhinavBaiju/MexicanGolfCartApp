document.addEventListener('DOMContentLoaded', () => {
    const forms = document.querySelectorAll('.gc-booking-form');

    // Configuration
    const API_BASE = '/apps/rental';
    const DEBOUNCE_DELAY = 500;

    forms.forEach(form => {
        const elements = {
            start: form.querySelector('[name="booking_start_date"]'),
            end: form.querySelector('[name="booking_end_date"]'),
            location: form.querySelector('[name="booking_location"]'),
            quantity: form.querySelector('[name="booking_quantity"]'),
            submitBtn: form.querySelector('.gc-submit-btn'),
            statusMsg: form.querySelector('.gc-status-message'),
            container: form.closest('.gc-booking-widget'),
            timerContainer: form.querySelector('#gc-timer-container'),
            timerText: form.querySelector('#gc-timer-text'),
            errorState: document.querySelector('.gc-error-state') // Global or scoped if inside widget
        };

        const productId = form.dataset.productId;
        const variantId = form.dataset.variantId;

        let debounceTimer = null;
        let countdownInterval = null;
        let currentBookingToken = null;

        // Initialize
        init();

        function init() {
            setMinDates();
            fetchLocations();
            attachListeners();

            // Release on abandon
            window.addEventListener('pagehide', handleAbandon);
            // Also handle visibility change as backup? pagehide is better for unload.
        }

        function handleAbandon() {
            if (currentBookingToken) {
                const blob = new Blob([JSON.stringify({ booking_token: currentBookingToken })], { type: 'application/json' });
                navigator.sendBeacon(`${API_BASE}/release`, blob);
            }
        }

        function setMinDates() {
            const today = new Date().toISOString().split('T')[0];
            if (elements.start) elements.start.min = today;
            if (elements.end) elements.end.min = today;
        }

        async function fetchLocations() {
            try {
                const res = await fetch(`${API_BASE}/config`);
                if (!res.ok) throw new Error('Failed to load locations');
                const data = await res.json();

                if (data.locations && data.locations.length > 0) {
                    elements.location.innerHTML = '<option value="" disabled selected>Select a location</option>';
                    data.locations.forEach(loc => {
                        const option = document.createElement('option');
                        option.value = loc.id;
                        option.textContent = loc.name;
                        elements.location.appendChild(option);
                    });
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

            form.addEventListener('submit', handleSubmit);
        }

        function validateDates() {
            if (elements.start.value && elements.end.value) {
                if (elements.start.value > elements.end.value) {
                    elements.end.value = elements.start.value;
                }
            }
            if (elements.start.value && elements.end) {
                elements.end.min = elements.start.value;
            }
        }

        function debouncedCheckAvailability() {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(checkAvailability, DEBOUNCE_DELAY);
        }

        async function checkAvailability() {
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
                    quantity: elements.quantity.value
                });

                const res = await fetch(`${API_BASE}/availability?${params}`);
                if (!res.ok) throw new Error('Availability check failed');
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
                const holdRes = await fetch(`${API_BASE}/hold`, {
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
                                '_booking_token': holdData.booking_token,
                                'Start Date': elements.start.value,
                                'End Date': elements.end.value,
                                'Location': elements.location.value
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
