import { BlockStack, Text, InlineError, InlineStack, Spinner, Badge, Button, Modal, InlineGrid, Box } from '@shopify/polaris';
import { ViewIcon } from '@shopify/polaris-icons';
import { useState } from 'react';
import { useAuthenticatedFetch } from '../api';
import { SignedAgreementPdfPreview, type NormalizedRect } from './SignedAgreementPdfPreview';

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
    fulfillment_type?: string | null;
    delivery_address?: string | null;
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

interface BookingCardProps {
    booking: Booking;
    onMarkComplete?: (token: string) => Promise<void>;
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

    let badgeTone = 'info';
    if (booking.status === 'CONFIRMED') badgeTone = 'success';
    if (booking.status === 'EXPIRED' || booking.status === 'RELEASED' || booking.status === 'CANCELLED') badgeTone = 'critical';

    // Format dates
    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    };

    const handleConfirmComplete = async () => {
        if (!onMarkComplete) return;
        setCompleting(true);
        try {
            await onMarkComplete(booking.booking_token);
            setModalOpen(false);
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
                            <Button variant="secondary">Manage</Button>
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
                                {formatDate(booking.start_date)} to {formatDate(booking.end_date)}
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
