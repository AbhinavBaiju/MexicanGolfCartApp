import { AppProvider } from '@shopify/polaris';
import enTranslations from '@shopify/polaris/locales/en.json';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BookingCard } from '../BookingCard';
import type { Booking } from '../BookingCard';

const authenticatedFetchMock = vi.fn();

vi.mock('../../api', () => ({
    useAuthenticatedFetch: () => authenticatedFetchMock,
}));

vi.mock('../SignedAgreementPdfPreview', () => ({
    SignedAgreementPdfPreview: () => null,
}));

function createBooking(): Booking {
    return {
        booking_token: 'token-12345678',
        status: 'CONFIRMED',
        location_code: 'PLAYA',
        start_date: '2026-02-07',
        end_date: '2026-02-10',
        order_id: 555001,
        invalid_reason: null,
        created_at: '2026-02-01T00:00:00Z',
        fulfillment_type: 'Pick Up',
    };
}

function renderBookingCard(booking: Booking): void {
    render(
        <AppProvider i18n={enTranslations}>
            <BookingCard booking={booking} />
        </AppProvider>
    );
}

describe('BookingCard', () => {
    beforeEach(() => {
        authenticatedFetchMock.mockReset();
    });

    it('loads booking details when Manage is clicked', async () => {
        authenticatedFetchMock.mockResolvedValue(
            new Response(
                JSON.stringify({
                    ok: true,
                    booking: {
                        id: 1,
                        booking_token: 'token-12345678',
                        status: 'CONFIRMED',
                        location_code: 'PLAYA',
                        start_date: '2026-02-07',
                        end_date: '2026-02-10',
                        order_id: 555001,
                        invalid_reason: null,
                        created_at: '2026-02-01T00:00:00Z',
                        updated_at: '2026-02-01T00:00:00Z',
                    },
                    items: [],
                    days: [],
                }),
                {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                }
            )
        );

        renderBookingCard(createBooking());
        fireEvent.click(screen.getByRole('button', { name: 'Manage' }));

        await waitFor(() => {
            expect(authenticatedFetchMock).toHaveBeenCalledWith('/bookings/token-12345678');
        });
    });

    it('renders timezone-safe display dates for the booking range', () => {
        renderBookingCard(createBooking());
        expect(screen.getAllByText('February 7, 2026 to February 10, 2026').length).toBeGreaterThan(0);
    });
});
