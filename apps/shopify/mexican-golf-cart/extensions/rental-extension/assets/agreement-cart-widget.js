(() => {
  const PDF_JS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.min.js';
  const PDF_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.min.js';
  const SIGN_BUTTON_LABEL = 'Sign & Checkout';
  const VIEW_PDF_LABEL = 'View PDF';
  const SIGN_PDF_LABEL = 'Sign PDF';
  const SUBMIT_LABEL = 'Submit & Checkout';

  let pdfJsLoader = null;

  function loadPdfJs() {
    if (window.pdfjsLib) {
      return Promise.resolve(window.pdfjsLib);
    }
    if (pdfJsLoader) {
      return pdfJsLoader;
    }

    pdfJsLoader = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = PDF_JS_URL;
      script.async = true;
      script.onload = () => {
        if (!window.pdfjsLib) {
          reject(new Error('PDF.js failed to initialize.'));
          return;
        }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
        resolve(window.pdfjsLib);
      };
      script.onerror = () => reject(new Error('Failed to load PDF.js.'));
      document.head.appendChild(script);
    });

    return pdfJsLoader;
  }

  function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        fn(...args);
      }, delay);
    };
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function buildRentableKey(items) {
    const ids = new Set(items.map((item) => item.product_id));
    return Array.from(ids).sort().join('|');
  }

  class AgreementWidget {
    constructor(root) {
      this.root = root;
      this.shopDomain = root.dataset.shopDomain || '';
      this.apiBase = root.dataset.apiBase || '/apps/rental';
      this.checkoutTargets = [];
      this.state = {
        agreement: null,
        rentableProductIds: [],
        cartToken: '',
        cartRentableKey: '',
        signatureDataUrl: '',
        signedAgreementId: '',
        signedRentableKey: ''
      };
      this.pdf = {
        doc: null,
        url: '',
        pageNumber: 1
      };
      this.signaturePad = {
        canvas: null,
        ctx: null,
        drawing: false,
        empty: true
      };
      this.modalState = 'closed';
      this.modal = this.buildModal();
      this.init();
    }

    init() {
      if (!this.shopDomain) {
        console.error('Agreement widget missing shop domain.');
        return;
      }
      this.refreshCheckoutTargets();
      this.refreshState();
      this.observeCartChanges();
      window.addEventListener('resize', debounce(() => {
        if (this.modal.root.classList.contains('is-open')) {
          this.renderPdf();
        }
      }, 200));
    }

    refreshCheckoutTargets() {
      const targets = [];
      const pageCheckout = document.querySelector('#checkout');
      const drawerCheckout = document.querySelector('#CartDrawer-Checkout');
      const fallbackCheckout = document.querySelector('button[name="checkout"]');

      [pageCheckout, drawerCheckout, fallbackCheckout].forEach((button) => {
        if (button && !targets.includes(button)) {
          targets.push(button);
        }
      });

      this.checkoutTargets = targets.map((button) => {
        const existingButton = button.parentElement && button.parentElement.querySelector('.mgc-agreement-cta');
        const signButton = existingButton || this.createSignButton();
        if (!existingButton && button.parentElement) {
          button.parentElement.appendChild(signButton);
        }
        return {
          button,
          signButton,
          originalDisplay: button.style.display || ''
        };
      });
    }

    createSignButton() {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mgc-agreement-cta';
      button.textContent = SIGN_BUTTON_LABEL;
      button.style.display = 'none';
      button.addEventListener('click', () => this.openModal());
      return button;
    }

    async refreshState() {
      try {
        const previousAgreementId = this.state.agreement ? this.state.agreement.id : null;
        const [cartData, agreementData] = await Promise.all([
          this.fetchCart(),
          this.fetchAgreement()
        ]);

        if (!cartData) {
          this.restoreCheckout();
          return;
        }

        this.state.cartToken = cartData.token || '';
        const rentableProductIds = Array.isArray(agreementData?.rentable_product_ids)
          ? agreementData.rentable_product_ids
          : this.state.rentableProductIds;
        const nextAgreement = agreementData && 'agreement' in agreementData
          ? agreementData.agreement
          : this.state.agreement;

        this.state.rentableProductIds = rentableProductIds;
        this.state.agreement = nextAgreement || null;

        if (previousAgreementId && this.state.agreement && previousAgreementId !== this.state.agreement.id) {
          await this.resetSignature();
        }

        const rentableItems = cartData.items.filter((item) => rentableProductIds.includes(item.product_id));
        const requiresAgreement = rentableItems.length > 0;
        const rentableKey = buildRentableKey(rentableItems);

        if (this.state.signedAgreementId && this.state.signedRentableKey !== rentableKey) {
          await this.resetSignature();
        }

        this.state.cartRentableKey = rentableKey;

        if (requiresAgreement) {
          this.disableCheckout();
        } else {
          this.restoreCheckout();
        }
      } catch (error) {
        console.error('Agreement widget refresh failed', error);
      }
    }

    async fetchCart() {
      const response = await fetch('/cart.js', { credentials: 'same-origin' });
      if (!response.ok) {
        return null;
      }
      return response.json();
    }

    async fetchAgreement() {
      const response = await fetch(`${this.apiBase}/agreement/current?shop=${encodeURIComponent(this.shopDomain)}`);
      if (!response.ok) {
        return null;
      }
      return response.json();
    }

    disableCheckout() {
      this.refreshCheckoutTargets();
      this.checkoutTargets.forEach((target) => {
        target.button.style.display = 'none';
        target.button.disabled = true;
        target.signButton.style.display = '';
      });
    }

    restoreCheckout() {
      this.checkoutTargets.forEach((target) => {
        target.button.style.display = target.originalDisplay;
        target.button.disabled = false;
        target.signButton.style.display = 'none';
      });
    }

    observeCartChanges() {
      const debouncedRefresh = debounce(() => this.refreshState(), 400);
      const observer = new MutationObserver(debouncedRefresh);
      observer.observe(document.body, { childList: true, subtree: true });
      document.addEventListener('cart:updated', debouncedRefresh);
      document.addEventListener('cart:refresh', debouncedRefresh);
    }

    buildModal() {
      const modalRoot = document.createElement('div');
      modalRoot.className = 'mgc-agreement-modal';
      modalRoot.setAttribute('aria-hidden', 'true');

      const backdrop = document.createElement('div');
      backdrop.className = 'mgc-agreement-backdrop';

      const dialog = document.createElement('div');
      dialog.className = 'mgc-agreement-dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'mgc-agreement-title');
      dialog.tabIndex = -1;

      const header = document.createElement('div');
      header.className = 'mgc-agreement-header';

      const title = document.createElement('h2');
      title.className = 'mgc-agreement-title';
      title.id = 'mgc-agreement-title';
      title.textContent = 'Agreement Required';

      const closeButton = document.createElement('button');
      closeButton.className = 'mgc-agreement-close';
      closeButton.type = 'button';
      closeButton.setAttribute('aria-label', 'Close');
      closeButton.innerHTML = '&times;';

      header.appendChild(title);
      header.appendChild(closeButton);

      const body = document.createElement('div');
      body.className = 'mgc-agreement-body';

      const errorBanner = document.createElement('div');
      errorBanner.className = 'mgc-agreement-error';
      errorBanner.style.display = 'none';

      const actions = document.createElement('div');
      actions.className = 'mgc-agreement-actions';

      const signButton = document.createElement('button');
      signButton.className = 'mgc-agreement-btn';
      signButton.type = 'button';
      signButton.textContent = SIGN_PDF_LABEL;

      const viewPdfButton = document.createElement('button');
      viewPdfButton.className = 'mgc-agreement-btn secondary';
      viewPdfButton.type = 'button';
      viewPdfButton.textContent = VIEW_PDF_LABEL;

      actions.appendChild(signButton);
      actions.appendChild(viewPdfButton);

      const pdfWrapper = document.createElement('div');
      pdfWrapper.className = 'mgc-agreement-pdf';

      const pdfCanvas = document.createElement('canvas');
      pdfWrapper.appendChild(pdfCanvas);

      const signatureBox = document.createElement('div');
      signatureBox.className = 'mgc-agreement-signature-box';
      signatureBox.textContent = 'Sign here';
      pdfWrapper.appendChild(signatureBox);

      const signaturePad = document.createElement('div');
      signaturePad.className = 'mgc-agreement-signature-pad';

      const signatureCanvas = document.createElement('canvas');
      signaturePad.appendChild(signatureCanvas);

      const signatureActions = document.createElement('div');
      signatureActions.className = 'mgc-agreement-signature-actions';

      const confirmButton = document.createElement('button');
      confirmButton.type = 'button';
      confirmButton.className = 'mgc-agreement-btn';
      confirmButton.textContent = 'Confirm';

      const clearButton = document.createElement('button');
      clearButton.type = 'button';
      clearButton.className = 'mgc-agreement-btn secondary';
      clearButton.textContent = 'Clear';

      signatureActions.appendChild(confirmButton);
      signatureActions.appendChild(clearButton);
      signaturePad.appendChild(signatureActions);

      const submitButton = document.createElement('button');
      submitButton.type = 'button';
      submitButton.className = 'mgc-agreement-btn mgc-agreement-submit';
      submitButton.textContent = SUBMIT_LABEL;
      submitButton.style.display = 'none';

      body.appendChild(errorBanner);
      body.appendChild(actions);
      body.appendChild(pdfWrapper);
      body.appendChild(signaturePad);
      body.appendChild(submitButton);

      dialog.appendChild(header);
      dialog.appendChild(body);
      modalRoot.appendChild(backdrop);
      modalRoot.appendChild(dialog);
      document.body.appendChild(modalRoot);

      backdrop.addEventListener('click', () => this.closeModal());
      closeButton.addEventListener('click', () => this.closeModal());
      viewPdfButton.addEventListener('click', () => this.togglePdfView());
      signButton.addEventListener('click', () => this.startSigning());
      clearButton.addEventListener('click', () => this.clearSignature());
      confirmButton.addEventListener('click', () => this.confirmSignature());
      submitButton.addEventListener('click', () => this.submitSignature());

      modalRoot.addEventListener('keydown', (event) => this.handleFocusTrap(event));
      modalRoot.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          this.closeModal();
        }
      });

      this.signaturePad.canvas = signatureCanvas;

      return {
        root: modalRoot,
        backdrop,
        dialog,
        title,
        errorBanner,
        actions,
        signButton,
        viewPdfButton,
        pdfWrapper,
        pdfCanvas,
        signatureBox,
        signaturePad,
        signatureCanvas,
        confirmButton,
        clearButton,
        submitButton
      };
    }

    openModal() {
      this.modal.root.classList.add('is-open');
      this.modal.root.setAttribute('aria-hidden', 'false');
      this.setModalState('pre-sign');
      if (!this.state.agreement) {
        this.setError('Agreement is not available yet. Please contact the store.');
        this.modal.signButton.disabled = true;
        this.modal.viewPdfButton.disabled = true;
      } else {
        this.modal.signButton.disabled = false;
        this.modal.viewPdfButton.disabled = false;
      }
      this.modal.dialog.focus();
    }

    closeModal() {
      this.modal.root.classList.remove('is-open');
      this.modal.root.setAttribute('aria-hidden', 'true');
      this.setError(null);
    }

    setError(message) {
      if (message) {
        this.modal.errorBanner.textContent = message;
        this.modal.errorBanner.style.display = 'block';
      } else {
        this.modal.errorBanner.textContent = '';
        this.modal.errorBanner.style.display = 'none';
      }
    }

    setModalState(state) {
      this.modalState = state;
      const showPdf = state !== 'pre-sign';
      const showSignaturePad = state === 'signing';
      const showSubmit = state === 'confirmed';
      const showActions = state === 'pre-sign';

      this.modal.pdfWrapper.classList.toggle('is-visible', showPdf);
      this.modal.signaturePad.classList.toggle('is-visible', showSignaturePad);
      this.modal.submitButton.style.display = showSubmit ? 'block' : 'none';
      this.modal.actions.style.display = showActions ? 'flex' : 'none';

      const missingAgreement = !this.state.agreement;
      this.modal.signButton.disabled = state === 'submitting' || missingAgreement;
      this.modal.viewPdfButton.disabled = state === 'submitting' || missingAgreement;
      this.modal.submitButton.disabled = state === 'submitting' || missingAgreement;
      this.modal.confirmButton.disabled = state === 'submitting' || missingAgreement;
      this.modal.clearButton.disabled = state === 'submitting' || missingAgreement;

      if (state === 'pre-sign') {
        this.modal.signatureBox.classList.remove('confirmed');
        this.modal.signatureBox.textContent = 'Sign here';
        this.modal.signatureBox.innerHTML = 'Sign here';
      }
      if (state === 'confirmed') {
        this.modal.signatureBox.classList.add('confirmed');
        this.modal.signatureBox.textContent = '';
      }
    }

    async togglePdfView() {
      if (!this.state.agreement) {
        this.setError('Agreement is not available yet.');
        return;
      }
      this.setModalState('pre-sign');
      this.modal.pdfWrapper.classList.toggle('is-visible');
      if (this.modal.pdfWrapper.classList.contains('is-visible')) {
        await this.renderPdf();
      }
    }

    async startSigning() {
      if (!this.state.agreement) {
        this.setError('Agreement is not available yet.');
        return;
      }
      this.setError(null);
      this.setModalState('signing');
      await this.renderPdf();
      this.setupSignaturePad();
    }

    setupSignaturePad() {
      const canvas = this.signaturePad.canvas;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#0b3d2e';

      this.signaturePad.ctx = ctx;
      this.signaturePad.empty = true;

      canvas.onpointerdown = (event) => {
        canvas.setPointerCapture(event.pointerId);
        this.signaturePad.drawing = true;
        this.signaturePad.empty = false;
        ctx.beginPath();
        ctx.moveTo(event.offsetX, event.offsetY);
      };
      canvas.onpointermove = (event) => {
        if (!this.signaturePad.drawing) return;
        ctx.lineTo(event.offsetX, event.offsetY);
        ctx.stroke();
      };
      canvas.onpointerup = (event) => {
        this.signaturePad.drawing = false;
        canvas.releasePointerCapture(event.pointerId);
      };
      canvas.onpointerleave = () => {
        this.signaturePad.drawing = false;
      };
    }

    clearSignature() {
      const canvas = this.signaturePad.canvas;
      const ctx = this.signaturePad.ctx;
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      this.signaturePad.empty = true;
    }

    confirmSignature() {
      if (this.signaturePad.empty || !this.signaturePad.canvas) {
        this.setError('Please provide a signature before confirming.');
        return;
      }
      this.setError(null);
      this.state.signatureDataUrl = this.signaturePad.canvas.toDataURL('image/png');
      this.placeSignatureImage();
      this.setModalState('confirmed');
    }

    placeSignatureImage() {
      if (!this.state.signatureDataUrl) return;
      this.modal.signatureBox.classList.add('confirmed');
      this.modal.signatureBox.innerHTML = '';
      const img = document.createElement('img');
      img.src = this.state.signatureDataUrl;
      img.alt = 'Signature';
      this.modal.signatureBox.appendChild(img);
    }

    async submitSignature() {
      if (!this.state.agreement || !this.state.signatureDataUrl) {
        this.setError('Signature not ready yet.');
        return;
      }
      if (!this.state.cartToken) {
        this.setError('Cart token missing. Please refresh the page.');
        return;
      }

      this.setModalState('submitting');
      this.setError(null);

      try {
        const response = await fetch(`${this.apiBase}/agreement/sign?shop=${encodeURIComponent(this.shopDomain)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cart_token: this.state.cartToken,
            agreement_id: this.state.agreement.id,
            signature_data_url: this.state.signatureDataUrl
          })
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data?.error || 'Failed to submit signature.');
        }

        const data = await response.json();
        const signedId = data.signed_agreement_id;
        if (!signedId) {
          throw new Error('Signature ID missing.');
        }

        this.state.signedAgreementId = signedId;
        this.state.signedRentableKey = this.state.cartRentableKey;

        await this.updateCartAttributes(signedId, this.state.agreement.version);
        this.triggerCheckout();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Signature submission failed.';
        this.setError(message);
        this.setModalState('confirmed');
      }
    }

    async updateCartAttributes(signatureId, version) {
      await fetch('/cart/update.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attributes: {
            agreement_signature_id: signatureId || '',
            agreement_version: version ? String(version) : ''
          }
        })
      });
    }

    async resetSignature() {
      this.state.signatureDataUrl = '';
      this.state.signedAgreementId = '';
      this.state.signedRentableKey = '';
      this.modal.signatureBox.classList.remove('confirmed');
      this.modal.signatureBox.innerHTML = 'Sign here';
      await this.updateCartAttributes('', '');
    }

    triggerCheckout() {
      const target = this.checkoutTargets.find((item) => item.button);
      if (!target) {
        this.setError('Checkout button not found.');
        return;
      }
      const button = target.button;
      const formId = button.getAttribute('form');
      const form = formId ? document.getElementById(formId) : button.closest('form');
      if (form) {
        form.submit();
        return;
      }
      button.click();
    }

    async renderPdf() {
      if (!this.state.agreement) return;
      const pdfUrl = this.state.agreement.pdf_url;
      if (!pdfUrl) return;

      try {
        const pdfjs = await loadPdfJs();
        if (!this.pdf.doc || this.pdf.url !== pdfUrl) {
          this.pdf.doc = await pdfjs.getDocument({ url: pdfUrl }).promise;
          this.pdf.url = pdfUrl;
        }

        const pageNumber = clamp(
          Number(this.state.agreement.page_number) || 1,
          1,
          this.pdf.doc.numPages || 1
        );

        this.pdf.pageNumber = pageNumber;
        const page = await this.pdf.doc.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        const containerWidth = this.modal.pdfWrapper.clientWidth || 640;
        const scale = containerWidth / viewport.width;
        const scaledViewport = page.getViewport({ scale });
        const canvas = this.modal.pdfCanvas;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = scaledViewport.width;
        canvas.height = scaledViewport.height;
        await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;

        this.updateSignatureBoxPosition();
        if (this.state.signatureDataUrl) {
          this.placeSignatureImage();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to render PDF.';
        this.setError(message);
      }
    }

    updateSignatureBoxPosition() {
      const agreement = this.state.agreement;
      if (!agreement) return;

      const canvas = this.modal.pdfCanvas;
      const box = this.modal.signatureBox;
      const width = canvas.width;
      const height = canvas.height;
      if (!width || !height) return;

      const left = agreement.x * width;
      const top = agreement.y * height;
      const boxWidth = agreement.width * width;
      const boxHeight = agreement.height * height;

      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      box.style.width = `${boxWidth}px`;
      box.style.height = `${boxHeight}px`;
    }

    handleFocusTrap(event) {
      if (event.key !== 'Tab') return;
      const focusable = this.modal.dialog.querySelectorAll('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])');
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        last.focus();
        event.preventDefault();
      } else if (!event.shiftKey && document.activeElement === last) {
        first.focus();
        event.preventDefault();
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-agreement-widget]').forEach((root) => {
      new AgreementWidget(root);
    });
  });
})();
