/**
 * Booking Widget - JavaScript Controller
 * 
 * Handles date selection, price calculation, availability checking,
 * and add-to-cart functionality for the booking app block.
 */

class BookingWidget {
  constructor(container) {
    this.container = container;
    this.productId = container.dataset.productId;
    this.productHandle = container.dataset.productHandle;
    this.variantId = container.dataset.variantId;
    this.dailyRate = parseInt(container.dataset.dailyRate, 10) || 0;
    this.currency = container.dataset.currency || 'USD';
    this.moneyFormat = container.dataset.moneyFormat || '${{amount}}';
    this.shopDomain = container.dataset.shopDomain;
    this.apiBase = container.dataset.apiBase || '/apps/rental';
    
    // State
    this.currentBookingToken = null;
    this.countdownInterval = null;
    this.debounceTimer = null;
    this.isSubmitting = false;
    
    // DOM Elements
    this.elements = this.getElements();
    
    this.init();
  }
  
  getElements() {
    const form = this.container.querySelector('[data-booking-form]');
    return {
      form,
      pickupDate: this.container.querySelector('[data-pickup-date]'),
      returnDate: this.container.querySelector('[data-return-date]'),
      summary: this.container.querySelector('[data-booking-summary]'),
      nightsCount: this.container.querySelector('[data-nights-count]'),
      pricePerNight: this.container.querySelector('[data-price-per-night]'),
      totalPrice: this.container.querySelector('[data-total-price]'),
      statusMessage: this.container.querySelector('[data-status-message]'),
      timerContainer: this.container.querySelector('[data-timer-container]'),
      timerText: this.container.querySelector('[data-timer-text]'),
      submitBtn: this.container.querySelector('[data-submit-btn]')
    };
  }
  
  init() {
    this.initDatePickers();
    this.attachEventListeners();
    this.updatePriceDisplay();
    
    // Handle page unload to release holds
    window.addEventListener('pagehide', () => this.handleAbandon());
    window.addEventListener('beforeunload', () => this.handleAbandon());
  }
  
  initDatePickers() {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Format dates as YYYY-MM-DD for input min attribute
    const formatDate = (date) => date.toISOString().split('T')[0];
    
    // Set minimum dates
    this.elements.pickupDate.min = formatDate(today);
    this.elements.returnDate.min = formatDate(tomorrow);
  }
  
  attachEventListeners() {
    // Date change handlers
    this.elements.pickupDate.addEventListener('change', () => {
      this.onPickupDateChange();
      this.debouncedCheckAvailability();
    });
    
    this.elements.returnDate.addEventListener('change', () => {
      this.validateDates();
      this.calculatePricing();
      this.debouncedCheckAvailability();
    });
    
    // Form submission
    this.elements.form.addEventListener('submit', (e) => this.handleSubmit(e));
  }
  
  onPickupDateChange() {
    const pickupDate = new Date(this.elements.pickupDate.value);
    
    if (!isNaN(pickupDate.getTime())) {
      // Set return date minimum to day after pickup
      const minReturn = new Date(pickupDate);
      minReturn.setDate(minReturn.getDate() + 1);
      this.elements.returnDate.min = minReturn.toISOString().split('T')[0];
      
      // Clear return date if it's now invalid
      if (this.elements.returnDate.value) {
        const returnDate = new Date(this.elements.returnDate.value);
        if (returnDate <= pickupDate) {
          this.elements.returnDate.value = '';
        }
      }
    }
    
    this.validateDates();
    this.calculatePricing();
  }
  
  validateDates() {
    const pickupValue = this.elements.pickupDate.value;
    const returnValue = this.elements.returnDate.value;
    
    if (!pickupValue || !returnValue) {
      return false;
    }
    
    const pickup = new Date(pickupValue);
    const returnDate = new Date(returnValue);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Pickup must be today or later
    if (pickup < today) {
      this.updateStatus('Pickup date must be today or later', 'error');
      return false;
    }
    
    // Return must be after pickup
    if (returnDate <= pickup) {
      this.updateStatus('Return date must be after pickup date', 'error');
      return false;
    }
    
    return true;
  }
  
  calculateNights() {
    const pickupValue = this.elements.pickupDate.value;
    const returnValue = this.elements.returnDate.value;
    
    if (!pickupValue || !returnValue) {
      return 0;
    }
    
    const pickup = new Date(pickupValue);
    const returnDate = new Date(returnValue);
    const diffTime = returnDate.getTime() - pickup.getTime();
    const nights = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return Math.max(0, nights);
  }
  
  calculatePricing() {
    const nights = this.calculateNights();
    
    if (nights > 0) {
      const total = nights * this.dailyRate;
      
      // Show summary
      this.elements.summary.style.display = 'flex';
      this.elements.nightsCount.textContent = `${nights} night${nights !== 1 ? 's' : ''}`;
      this.elements.pricePerNight.textContent = this.formatMoney(this.dailyRate) + '/night';
      this.elements.totalPrice.textContent = this.formatMoney(total);
    } else {
      this.elements.summary.style.display = 'none';
    }
    
    return nights;
  }
  
  updatePriceDisplay() {
    if (this.elements.pricePerNight) {
      this.elements.pricePerNight.textContent = this.formatMoney(this.dailyRate) + '/night';
    }
  }
  
  formatMoney(cents) {
    const amount = (cents / 100).toFixed(2);
    return this.moneyFormat
      .replace('{{amount}}', amount)
      .replace('{{amount_no_decimals}}', Math.round(cents / 100))
      .replace('{{amount_with_comma_separator}}', amount.replace('.', ','));
  }
  
  debouncedCheckAvailability() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.checkAvailability(), 500);
  }
  
  async checkAvailability() {
    const nights = this.calculateNights();
    
    if (nights <= 0) {
      this.updateStatus('', '');
      this.elements.submitBtn.disabled = true;
      return;
    }
    
    if (!this.validateDates()) {
      this.elements.submitBtn.disabled = true;
      return;
    }
    
    this.updateStatus('Checking availability...', 'loading');
    
    try {
      const params = new URLSearchParams({
        product_id: this.productId,
        start_date: this.elements.pickupDate.value,
        end_date: this.elements.returnDate.value,
        quantity: '1',
        shop: this.shopDomain
      });
      
      const response = await fetch(`${this.apiBase}/availability?${params}`);
      
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Check failed (${response.status})`);
      }
      
      const data = await response.json();
      
      if (data.available) {
        this.updateStatus('✓ Available', 'success');
        this.elements.submitBtn.disabled = false;
        this.elements.submitBtn.textContent = 'Reserve Now';
      } else {
        const msg = data.error || 'Not available for selected dates';
        this.updateStatus(msg, 'error');
        this.elements.submitBtn.disabled = true;
        this.elements.submitBtn.textContent = 'Check Availability';
      }
    } catch (err) {
      console.error('Availability check error:', err);
      this.updateStatus('Error checking availability', 'error');
      // Keep button enabled to allow retry
      this.elements.submitBtn.disabled = false;
    }
  }
  
  async handleSubmit(e) {
    e.preventDefault();
    
    if (this.isSubmitting) return;
    
    if (!this.validateDates()) {
      return;
    }
    
    this.isSubmitting = true;
    this.elements.submitBtn.disabled = true;
    this.elements.submitBtn.classList.add('booking-form__submit--loading');
    this.updateStatus('Processing...', 'loading');
    
    try {
      // Step 1: Create Hold
      const holdResponse = await fetch(`${this.apiBase}/hold?shop=${this.shopDomain}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_date: this.elements.pickupDate.value,
          end_date: this.elements.returnDate.value,
          items: [{
            product_id: parseInt(this.productId, 10),
            variant_id: parseInt(this.variantId, 10),
            qty: 1
          }]
        })
      });
      
      const holdData = await holdResponse.json();
      
      if (!holdResponse.ok || !holdData.booking_token) {
        throw new Error(holdData.error || 'Failed to reserve booking');
      }
      
      this.currentBookingToken = holdData.booking_token;
      
      // Start countdown timer
      if (holdData.expires_at) {
        this.startCountdown(holdData.expires_at);
      }
      
      // Step 2: Add to Cart
      this.updateStatus('Adding to cart...', 'loading');
      
      const nights = this.calculateNights();
      
      const cartResponse = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{
            id: parseInt(this.variantId, 10),
            quantity: nights, // Quantity = number of nights
            properties: {
              'booking_token': holdData.booking_token,
              'Start Date': this.elements.pickupDate.value,
              'End Date': this.elements.returnDate.value,
              'Nights': nights.toString()
            }
          }]
        })
      });
      
      if (!cartResponse.ok) {
        throw new Error('Failed to add to cart');
      }
      
      // Clear token so we don't release on unload
      this.currentBookingToken = null;
      
      // Redirect to cart
      window.location.href = '/cart';
      
    } catch (err) {
      console.error('Booking submission error:', err);
      this.updateStatus(err.message, 'error');
      this.elements.submitBtn.disabled = false;
      this.elements.submitBtn.textContent = 'Retry';
    } finally {
      this.isSubmitting = false;
      this.elements.submitBtn.classList.remove('booking-form__submit--loading');
    }
  }
  
  startCountdown(expiresAtIso) {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }
    
    const expiresAt = new Date(expiresAtIso).getTime();
    this.elements.timerContainer.style.display = 'flex';
    
    const updateTimer = () => {
      const now = Date.now();
      const remaining = expiresAt - now;
      
      if (remaining <= 0) {
        clearInterval(this.countdownInterval);
        this.elements.timerText.textContent = 'Reservation Expired';
        this.handleExpiry();
        return;
      }
      
      const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
      
      this.elements.timerText.textContent = `Held for ${minutes}:${seconds.toString().padStart(2, '0')}`;
    };
    
    updateTimer();
    this.countdownInterval = setInterval(updateTimer, 1000);
  }
  
  handleExpiry() {
    this.currentBookingToken = null;
    this.updateStatus('Reservation expired. Please try again.', 'error');
    this.elements.submitBtn.disabled = true;
    this.elements.submitBtn.textContent = 'Expired';
    
    // Add refresh link
    const refreshLink = document.createElement('a');
    refreshLink.href = '#';
    refreshLink.textContent = 'Refresh to try again';
    refreshLink.style.display = 'block';
    refreshLink.style.textAlign = 'center';
    refreshLink.style.marginTop = '8px';
    refreshLink.style.color = 'inherit';
    refreshLink.onclick = (e) => {
      e.preventDefault();
      location.reload();
    };
    this.elements.statusMessage.appendChild(refreshLink);
  }
  
  handleAbandon() {
    if (this.currentBookingToken) {
      const payload = JSON.stringify({ booking_token: this.currentBookingToken });
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(`${this.apiBase}/release?shop=${this.shopDomain}`, blob);
    }
  }
  
  updateStatus(message, type = 'info') {
    if (!this.elements.statusMessage) return;
    
    // Log for debugging
    if (message) {
      console.debug(`[BookingWidget] ${message} (${type})`);
    }
    
    this.elements.statusMessage.textContent = message;
    this.elements.statusMessage.className = 'booking-form__status';
    
    if (type && message) {
      this.elements.statusMessage.classList.add(`booking-form__status--${type}`);
    }
  }
}

// Initialize all booking widgets on the page
document.addEventListener('DOMContentLoaded', () => {
  const widgets = document.querySelectorAll('[data-booking-widget]');
  
  widgets.forEach((container) => {
    try {
      new BookingWidget(container);
    } catch (err) {
      console.error('Failed to initialize BookingWidget:', err);
    }
  });
});

// Export for potential external use
if (typeof window !== 'undefined') {
  window.BookingWidget = BookingWidget;
}
