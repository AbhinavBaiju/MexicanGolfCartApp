import { BlockStack, Text, InlineError, InlineStack, Spinner, Badge, Button, Modal, InlineGrid, Box } from '@shopify/polaris';
import { ViewIcon } from '@shopify/polaris-icons';
import { useState } from 'react';
import { useAuthenticatedFetch } from '../api';
import { SignedAgreementPdfPreview, type NormalizedRect } from './SignedAgreementPdfPreview';
import { formatDateForDisplay } from '../utils/date';

export interface Booking {
    booking_token: string;
    status: string;
    location_code: string;
    start_date: string;
    end_date: string;
    order_id: number | null;
    signed_agreement_id?: string | null;
    invalid_reason: string | null;
    created_at: string;
    customer_name?: string | null;
    customer_email?: string | null;
    revenue?: number | string | null;
    fulfillment_type?: string | null;
    delivery_address?: string | null;
    service_count?: number | string | null;
    service_product_ids?: string | null;
    has_upsell?: number | boolean | null;
}

interface AgreementData {
    id: string;
    version: number;
    title: string | null;
    pdf_url: string;
    page_number: number;
    x: number;
    y: number;
    width: number;
    height: number;
}

interface SignedAgreementDetail {
    id: string;
    agreement_version: number;
    signed_at: string;
    order_id: string | null;
    customer_email: string | null;
    status: string;
    signature_png_base64: string;
}

interface SignedAgreementDetailResponse {
    ok: boolean;
    signed_agreement: SignedAgreementDetail;
    agreement: AgreementData;
}

interface BookingDetail extends Booking {
    id: number;
    expires_at?: string | null;
}

interface BookingDetailItem {
    product_id: number;
    variant_id?: number | null;
    qty: number;
}

interface BookingDetailDay {
    product_id: number;
    date: string;
    qty: number;
}

interface BookingDetailResponse {
    ok?: boolean;
    error?: string;
    booking?: BookingDetail;
    items?: BookingDetailItem[];
    days?: BookingDetailDay[];
}

interface BookingCardProps {
    booking: Booking;
    onMarkComplete?: (token: string) => Promise<boolean>;
}

export function BookingCard({ booking, onMarkComplete }: BookingCardProps) {
    const fetch = useAuthenticatedFetch();
    const [modalOpen, setModalOpen] = useState(false);
    const [completing, setCompleting] = useState(false);

    const [agreementModalOpen, setAgreementModalOpen] = useState(false);
    const [agreementLoading, setAgreementLoading] = useState(false);
    const [agreementError, setAgreementError] = useState<string | null>(null);
    const [signedAgreement, setSignedAgreement] = useState<SignedAgreementDetail | null>(null);
    const [agreementDoc, setAgreementDoc] = useState<AgreementData | null>(null);
    const [manageModalOpen, setManageModalOpen] = useState(false);
    const [manageLoading, setManageLoading] = useState(false);
    const [manageError, setManageError] = useState<string | null>(null);
    const [manageBooking, setManageBooking] = useState<BookingDetail | null>(null);
    const [manageItems, setManageItems] = useState<BookingDetailItem[]>([]);
    const [manageDays, setManageDays] = useState<BookingDetailDay[]>([]);

    const getBadgeTone = (status: string): 'info' | 'success' | 'critical' => {
        if (status === 'CONFIRMED') return 'success';
        if (status === 'EXPIRED' || status === 'RELEASED' || status === 'CANCELLED') return 'critical';
        return 'info';
    };
    const badgeTone = getBadgeTone(booking.status);

    const handleConfirmComplete = async () => {
        if (!onMarkComplete) return;
        setCompleting(true);
        try {
            const completed = await onMarkComplete(booking.booking_token);
            if (completed) {
                setModalOpen(false);
            }
        } catch (e: unknown) {
            console.error('Failed to complete booking', e);
        } finally {
            setCompleting(false);
        }
    };

    const openAgreementModal = async () => {
        setAgreementModalOpen(true);
        setAgreementError(null);
        setSignedAgreement(null);
        setAgreementDoc(null);

        if (!booking.signed_agreement_id) {
            setAgreementError('No signed agreement is linked to this booking yet.');
            return;
        }

        setAgreementLoading(true);
        try {
            const response = await fetch(`/agreement/signed/${booking.signed_agreement_id}`);
            if (!response.ok) {
                const data = await response.json().catch(() => null);
                throw new Error(data?.error || 'Failed to load signed agreement.');
            }
            const data: SignedAgreementDetailResponse = await response.json();
            setSignedAgreement(data.signed_agreement);
            setAgreementDoc(data.agreement);
        } catch (e: unknown) {
            setAgreementError(e instanceof Error ? e.message : 'Failed to load signed agreement.');
        } finally {
            setAgreementLoading(false);
        }
    };

    const openManageModal = async () => {
        setManageModalOpen(true);
        setManageLoading(true);
        setManageError(null);
        setManageBooking(null);
        setManageItems([]);
        setManageDays([]);

        try {
            const response = await fetch(`/bookings/${booking.booking_token}`);
            const data = (await response.json().catch(() => null)) as BookingDetailResponse | null;
            if (!response.ok || !data?.ok || !data.booking) {
                const message = data?.error || 'Failed to load booking details.';
                throw new Error(message);
            }

            setManageBooking(data.booking);
            setManageItems(Array.isArray(data.items) ? data.items : []);
            setManageDays(Array.isArray(data.days) ? data.days : []);
        } catch (e: unknown) {
            setManageError(e instanceof Error ? e.message : 'Failed to load booking details.');
        } finally {
            setManageLoading(false);
        }
    };

    return (
        <>
            <div style={{
                background: 'white',
                borderRadius: '12px',
                padding: '16px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                marginBottom: '12px',
                border: '1px solid #e1e3e5'
            }}>
                <InlineStack align="space-between" blockAlign="start" gap="400" wrap={false}>
                    {/* Left Section: Image and Info */}
                    <InlineStack gap="400" wrap={false}>
                        {/* Image Placeholder */}
                        <div style={{
                            width: '80px',
                            height: '80px',
                            borderRadius: '8px',
                            backgroundColor: '#f1f2f3',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0
                        }}>
                            {/* Placeholder Icon or Image */}
                            <img
                                src="https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png"
                                alt="Golf Cart"
                                style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: '8px', objectFit: 'cover' }}
                            />
                        </div>

                        {/* Info */}
                        <BlockStack gap="100">
                            <Text as="p" variant="bodyMd" fontWeight="semibold" tone="subdued">
                                #{booking.order_id || 'N/A'} • {booking.location_code}
                            </Text>
                            <Text as="h3" variant="headingMd">
                                Booking {booking.booking_token.substring(0, 8)}
                            </Text>
                            <Text as="p" tone="subdued" variant="bodySm">
                                Location: {booking.location_code}
                            </Text>
                            {booking.fulfillment_type && (
                                <Text as="p" tone="subdued" variant="bodySm">
                                    {booking.fulfillment_type === 'Pick Up' ? '📍 Pick Up' : '🚚 Delivery'}
                                    {booking.delivery_address ? ` • ${booking.delivery_address}` : ''}
                                </Text>
                            )}
                            <div style={{ marginTop: '4px' }}>
                                <Badge tone={badgeTone as 'info' | 'success' | 'critical'}>{booking.status}</Badge>
                            </div>
                        </BlockStack>
                    </InlineStack>

                    {/* Right Section: Actions and Date */}
                    <BlockStack align="end" gap="400">
                        <InlineStack gap="200">
                            <Button
                                icon={ViewIcon}
                                variant="secondary"
                                onClick={openAgreementModal}
                                disabled={!booking.signed_agreement_id}
                            >
                                View agreement
                            </Button>
                            <Button variant="secondary" onClick={openManageModal}>Manage</Button>
                            <Button
                                variant="primary"
                                tone="critical"
                                onClick={() => setModalOpen(true)}
                                disabled={booking.status === 'RELEASED'}
                            >
                                Mark as Completed
                            </Button>
                        </InlineStack>

                        <div style={{ backgroundColor: '#f1f2f3', padding: '8px 12px', borderRadius: '6px' }}>
                            <Text as="span" fontWeight="bold">
                                {formatDateForDisplay(booking.start_date)} to {formatDateForDisplay(booking.end_date)}
                            </Text>
                        </div>
                        <Text as="p" tone="subdued" alignment="end">
                            Quantity: 1
                        </Text>
                    </BlockStack>
                </InlineStack>
            </div>

            <Modal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                title="Mark Booking as Completed?"
                primaryAction={{
                    content: 'Yes, Complete',
                    onAction: handleConfirmComplete,
                    loading: completing,
                    destructive: true,
                }}
                secondaryActions={[
                    {
                        content: 'No, Cancel',
                        onAction: () => setModalOpen(false),
                    },
                ]}
            >
                <Modal.Section>
                    <Text as="p">
                        Are you sure you want to mark this booking as completed? This will update the status to Fulfilled.
                    </Text>
                </Modal.Section>
            </Modal>

            <Modal
                open={manageModalOpen}
                onClose={() => setManageModalOpen(false)}
                title={`Manage Booking ${booking.booking_token.substring(0, 8)}`}
                size="large"
            >
                <Modal.Section>
                    <BlockStack gap="300">
                        {manageError && <InlineError message={manageError} fieldID="booking-manage-error" />}

                        {manageLoading ? (
                            <InlineStack gap="200" align="start" blockAlign="center">
                                <Spinner size="small" />
                                <Text as="span">Loading booking details…</Text>
                            </InlineStack>
                        ) : manageBooking ? (
                            <BlockStack gap="400">
                                <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                                    <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="300">
                                        <BlockStack gap="100">
                                            <Text as="p" variant="headingXs" tone="subdued">Status</Text>
                                            <Badge tone={getBadgeTone(manageBooking.status)}>{manageBooking.status}</Badge>
                                        </BlockStack>
                                        <BlockStack gap="100">
                                            <Text as="p" variant="headingXs" tone="subdued">Order ID</Text>
                                            <Text as="p" variant="bodyMd">{manageBooking.order_id || 'N/A'}</Text>
                                        </BlockStack>
                                        <BlockStack gap="100">
                                            <Text as="p" variant="headingXs" tone="subdued">Location</Text>
                                            <Text as="p" variant="bodyMd">{manageBooking.location_code}</Text>
                                        </BlockStack>
                                        <BlockStack gap="100">
                                            <Text as="p" variant="headingXs" tone="subdued">Start Date</Text>
                                            <Text as="p" variant="bodyMd">{formatDateForDisplay(manageBooking.start_date)}</Text>
                                        </BlockStack>
                                        <BlockStack gap="100">
                                            <Text as="p" variant="headingXs" tone="subdued">End Date</Text>
                                            <Text as="p" variant="bodyMd">{formatDateForDisplay(manageBooking.end_date)}</Text>
                                        </BlockStack>
                                        <BlockStack gap="100">
                                            <Text as="p" variant="headingXs" tone="subdued">Fulfillment</Text>
                                            <Text as="p" variant="bodyMd">
                                                {manageBooking.fulfillment_type || 'Pick Up'}
                                                {manageBooking.delivery_address ? ` • ${manageBooking.delivery_address}` : ''}
                                            </Text>
                                        </BlockStack>
                                        <BlockStack gap="100">
                                            <Text as="p" variant="headingXs" tone="subdued">Customer</Text>
                                            <Text as="p" variant="bodyMd">{manageBooking.customer_name || 'N/A'}</Text>
                                        </BlockStack>
                                        <BlockStack gap="100">
                                            <Text as="p" variant="headingXs" tone="subdued">Email</Text>
                                            <Text as="p" variant="bodyMd" breakWord>{manageBooking.customer_email || 'N/A'}</Text>
                                        </BlockStack>
                                        {manageBooking.expires_at ? (
                                            <BlockStack gap="100">
                                                <Text as="p" variant="headingXs" tone="subdued">Expires At</Text>
                                                <Text as="p" variant="bodyMd">{new Date(manageBooking.expires_at).toLocaleString()}</Text>
                                            </BlockStack>
                                        ) : null}
                                    </InlineGrid>
                                </Box>

                                <BlockStack gap="200">
                                    <Text as="h4" variant="headingSm">Booked Items</Text>
                                    {manageItems.length === 0 ? (
                                        <Text as="p" tone="subdued">No items found for this booking.</Text>
                                    ) : (
                                        <BlockStack gap="150">
                                            {manageItems.map((item, index) => (
                                                <Text
                                                    key={`${item.product_id}-${item.variant_id ?? 'none'}-${index}`}
                                                    as="p"
                                                    variant="bodyMd"
                                                >
                                                    Product {item.product_id}
                                                    {' • '}
                                                    Variant {item.variant_id ?? 'N/A'}
                                                    {' • '}
                                                    Qty {item.qty}
                                                </Text>
                                            ))}
                                        </BlockStack>
                                    )}
                                </BlockStack>

                                <BlockStack gap="200">
                                    <Text as="h4" variant="headingSm">Reserved Days</Text>
                                    {manageDays.length === 0 ? (
                                        <Text as="p" tone="subdued">No day-level reservations found.</Text>
                                    ) : (
                                        <BlockStack gap="150">
                                            {manageDays.map((day, index) => (
                                                <Text
                                                    key={`${day.date}-${day.product_id}-${index}`}
                                                    as="p"
                                                    variant="bodyMd"
                                                >
                                                    {formatDateForDisplay(day.date)}
                                                    {' • '}
                                                    Product {day.product_id}
                                                    {' • '}
                                                    Qty {day.qty}
                                                </Text>
                                            ))}
                                        </BlockStack>
                                    )}
                                </BlockStack>
                            </BlockStack>
                        ) : (
                            <Text as="p" tone="subdued">No booking details available.</Text>
                        )}
                    </BlockStack>
                </Modal.Section>
            </Modal>

            <Modal
                open={agreementModalOpen}
                onClose={() => setAgreementModalOpen(false)}
                title="Signed Agreement"
                size="fullScreen"
            >
                <Modal.Section>
                    <BlockStack gap="300">
                        {agreementError && <InlineError message={agreementError} fieldID="booking-agreement-error" />}

                        {agreementLoading ? (
                            <InlineStack gap="200" align="start" blockAlign="center">
                                <Spinner size="small" />
                                <Text as="span">Loading agreement…</Text>
                            </InlineStack>
                        ) : signedAgreement && agreementDoc ? (
                            <BlockStack gap="400">
                                <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                                    <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
                                        <BlockStack gap="100">
                                            <Text as="p" variant="headingXs" tone="subdued">Signed At</Text>
                                            <Text as="p" variant="bodyMd">{new Date(signedAgreement.signed_at).toLocaleString()}</Text>
                                        </BlockStack>
                                        <BlockStack gap="100">
                                            <Text as="p" variant="headingXs" tone="subdued">Order ID</Text>
                                            <Text as="p" variant="bodyMd">{signedAgreement.order_id || 'N/A'}</Text>
                                        </BlockStack>
                                        <BlockStack gap="100">
                                            <Text as="p" variant="headingXs" tone="subdued">Email</Text>
                                            <Text as="p" variant="bodyMd" breakWord>{signedAgreement.customer_email || 'N/A'}</Text>
                                        </BlockStack>
                                        <BlockStack gap="100">
                                            <Text as="p" variant="headingXs" tone="subdued">Version</Text>
                                            <Text as="p" variant="bodyMd">v{signedAgreement.agreement_version}</Text>
                                        </BlockStack>
                                    </InlineGrid>
                                </Box>

                                {signedAgreement.signature_png_base64 ? (
                                    <SignedAgreementPdfPreview
                                        pdfUrl={agreementDoc.pdf_url}
                                        signatureDataUrl={signedAgreement.signature_png_base64}
                                        signaturePageNumber={agreementDoc.page_number || 1}
                                        signatureRect={
                                            {
                                                x: agreementDoc.x,
                                                y: agreementDoc.y,
                                                width: agreementDoc.width,
                                                height: agreementDoc.height,
                                            } satisfies NormalizedRect
                                        }
                                    />
                                ) : (
                                    <Text as="p">Signature missing for this agreement.</Text>
                                )}
                            </BlockStack>
                        ) : (
                            <Text as="p">Select a booking to view its agreement.</Text>
                        )}
                    </BlockStack>
                </Modal.Section>
            </Modal>
        </>
    );
}
