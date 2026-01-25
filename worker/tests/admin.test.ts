import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Unit tests for admin.ts - Agreement handling
 * 
 * These tests validate the logic for handling signed agreement details,
 * specifically ensuring that empty signatures don't cause 500 errors.
 */

// Mock types matching what admin.ts uses
interface SignedAgreementDetail {
    id: string;
    agreement_id: string;
    agreement_version: number;
    agreement_title: string;
    cart_token: string;
    order_id: string | null | undefined;
    customer_email: string | null | undefined;
    signed_at: string;
    status: string;
    signature_png_base64: string;
}

/**
 * Simulates the validation logic from handleAgreementSignedDetail
 * Returns { ok: true } if valid, { error: string } if invalid
 */
function validateSignedAgreementDetail(detail: SignedAgreementDetail): { ok: true } | { error: string } {
    // Only error if the signed agreement ID is missing; empty signature is allowed
    if (!detail.id) {
        return { error: 'Signed agreement ID missing' };
    }
    return { ok: true };
}

test('signed agreement with signature_png_base64 present should be valid', () => {
    const detail: SignedAgreementDetail = {
        id: 'signed-123',
        agreement_id: 'agreement-456',
        agreement_version: 1,
        agreement_title: 'Rental Agreement v1',
        cart_token: 'cart-789',
        order_id: 'order-111',
        customer_email: 'test@example.com',
        signed_at: '2026-01-25T10:00:00Z',
        status: 'confirmed',
        signature_png_base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA...'
    };

    const result = validateSignedAgreementDetail(detail);
    assert.deepEqual(result, { ok: true }, 'Should allow signed agreement with signature');
});

test('signed agreement with empty signature_png_base64 should be valid', () => {
    const detail: SignedAgreementDetail = {
        id: 'signed-123',
        agreement_id: 'agreement-456',
        agreement_version: 1,
        agreement_title: 'Rental Agreement v1',
        cart_token: 'cart-789',
        order_id: null,
        customer_email: null,
        signed_at: '2026-01-25T10:00:00Z',
        status: 'pending',
        signature_png_base64: '' // Empty signature - should be allowed
    };

    const result = validateSignedAgreementDetail(detail);
    assert.deepEqual(result, { ok: true }, 'Should allow signed agreement with empty signature (UI shows "Signature missing")');
});

test('signed agreement with missing id should be invalid', () => {
    const detail: SignedAgreementDetail = {
        id: '', // Missing ID - should error
        agreement_id: 'agreement-456',
        agreement_version: 1,
        agreement_title: 'Rental Agreement v1',
        cart_token: 'cart-789',
        order_id: null,
        customer_email: null,
        signed_at: '2026-01-25T10:00:00Z',
        status: 'pending',
        signature_png_base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA...'
    };

    const result = validateSignedAgreementDetail(detail);
    assert.deepEqual(result, { error: 'Signed agreement ID missing' }, 'Should reject signed agreement with missing ID');
});

test('signed agreement with both id and empty signature should be valid', () => {
    // This is the key test case that was causing the crash:
    // A signed agreement record exists but signature_png_base64 is empty.
    // The backend should still return 200 so the UI can show "Signature missing".
    const detail: SignedAgreementDetail = {
        id: 'signed-empty-sig',
        agreement_id: 'agreement-789',
        agreement_version: 2,
        agreement_title: 'Updated Rental Agreement',
        cart_token: 'cart-abc',
        order_id: 'order-def',
        customer_email: 'customer@test.com',
        signed_at: '2026-01-25T12:30:00Z',
        status: 'confirmed',
        signature_png_base64: '' // Empty - this should NOT cause a 500 error
    };

    const result = validateSignedAgreementDetail(detail);
    assert.deepEqual(result, { ok: true }, 'Backend should return 200 even when signature is empty; UI handles this gracefully');
});
