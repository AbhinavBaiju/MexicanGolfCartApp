import {
  Page,
  Layout,
  Card,
  Text,
  Button,
  Modal,
  TextField,
  Select,
  InlineError,
  BlockStack,
  InlineStack,
  Badge,
  Spinner,
  IndexTable,
  Box
} from '@shopify/polaris';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useAuthenticatedFetch } from '../api';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { SignedAgreementPdfPreview, type NormalizedRect } from '../components/SignedAgreementPdfPreview';

interface AgreementData {
  id: string;
  version: number;
  active: boolean;
  title: string | null;
  pdf_url: string;
  pdf_storage_type: string;
  pdf_sha256: string | null;
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  created_at: string;
  created_by: string | null;
}

interface AgreementCurrentResponse {
  ok: boolean;
  agreement: AgreementData | null;
}

interface SignedAgreementListItem {
  id: string;
  agreement_id: string;
  agreement_version: number;
  agreement_title: string | null;
  cart_token: string;
  order_id: string | null;
  customer_email: string | null;
  signed_at: string;
  status: string;
}

interface SignedAgreementDetail extends SignedAgreementListItem {
  signature_png_base64: string;
}

interface SignedAgreementsResponse {
  ok: boolean;
  signed_agreements: SignedAgreementListItem[];
}

interface SignedAgreementDetailResponse {
  ok: boolean;
  signed_agreement: SignedAgreementDetail;
  agreement: AgreementData;
}

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface RectNormalized {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RectPixels {
  left: number;
  top: number;
  width: number;
  height: number;
}

type DragMode = 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se';

interface DragState {
  mode: DragMode;
  startX: number;
  startY: number;
  startRect: RectPixels;
}

const MIN_RECT_SIZE_PX = 24;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeRect(rect: RectPixels, containerWidth: number, containerHeight: number): RectNormalized {
  return {
    x: rect.left / containerWidth,
    y: rect.top / containerHeight,
    width: rect.width / containerWidth,
    height: rect.height / containerHeight
  };
}

function rectToPixels(rect: RectNormalized, containerWidth: number, containerHeight: number): RectPixels {
  return {
    left: rect.x * containerWidth,
    top: rect.y * containerHeight,
    width: rect.width * containerWidth,
    height: rect.height * containerHeight
  };
}

function formatDateTime(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function Agreement() {
  const fetch = useAuthenticatedFetch();
  const [activeAgreement, setActiveAgreement] = useState<AgreementData | null>(null);
  const [agreementLoading, setAgreementLoading] = useState(true);
  const [agreementError, setAgreementError] = useState<string | null>(null);

  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadPdfUrl, setUploadPdfUrl] = useState('');
  const [uploadStorageType, setUploadStorageType] = useState('EXTERNAL');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [pageNumber, setPageNumber] = useState(1);
  const [placement, setPlacement] = useState<RectNormalized>({ x: 0.1, y: 0.8, width: 0.3, height: 0.1 });
  const [placementDirty, setPlacementDirty] = useState(false);
  const [placementSaving, setPlacementSaving] = useState(false);
  const [placementError, setPlacementError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const [pdfPages, setPdfPages] = useState(1);
  const [pdfRendering, setPdfRendering] = useState(false);

  const [signedAgreements, setSignedAgreements] = useState<SignedAgreementListItem[]>([]);
  const [signedLoading, setSignedLoading] = useState(false);
  const [signedError, setSignedError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterOrderId, setFilterOrderId] = useState('');
  const [filterEmail, setFilterEmail] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  const [signedDetail, setSignedDetail] = useState<SignedAgreementDetail | null>(null);
  const [signedDetailAgreement, setSignedDetailAgreement] = useState<AgreementData | null>(null);
  const [signedDetailOpen, setSignedDetailOpen] = useState(false);

  const loadAgreement = useCallback(async () => {
    setAgreementLoading(true);
    setAgreementError(null);
    try {
      const response = await fetch('/agreement/current');
      if (!response.ok) {
        throw new Error('Failed to load agreement.');
      }
      const data: AgreementCurrentResponse = await response.json();
      setActiveAgreement(data.agreement);
      if (data.agreement) {
        setPlacement({
          x: data.agreement.x,
          y: data.agreement.y,
          width: data.agreement.width,
          height: data.agreement.height
        });
        setPageNumber(data.agreement.page_number || 1);
        setPlacementDirty(false);
        setPlacementError(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agreement load failed.';
      setAgreementError(message);
    } finally {
      setAgreementLoading(false);
    }
  }, [fetch]);

  const loadSignedAgreements = useCallback(async () => {
    setSignedLoading(true);
    setSignedError(null);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (filterOrderId) params.set('order_id', filterOrderId);
      if (filterEmail) params.set('email', filterEmail);
      if (filterStartDate) params.set('start_date', filterStartDate);
      if (filterEndDate) params.set('end_date', filterEndDate);

      const response = await fetch(`/agreement/signed?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to load signed agreements.');
      }
      const data: SignedAgreementsResponse = await response.json();
      setSignedAgreements(data.signed_agreements || []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Signed agreements load failed.';
      setSignedError(message);
    } finally {
      setSignedLoading(false);
    }
  }, [fetch, filterStatus, filterOrderId, filterEmail, filterStartDate, filterEndDate]);

  useEffect(() => {
    loadAgreement();
  }, [loadAgreement]);

  useEffect(() => {
    loadSignedAgreements();
  }, [loadSignedAgreements]);

  const openUploadModal = () => {
    setUploadTitle('');
    setUploadPdfUrl('');
    setUploadStorageType('EXTERNAL');
    setUploadError(null);
    setUploadModalOpen(true);
  };

  const handleUpload = async () => {
    setUploading(true);
    setUploadError(null);

    try {
      const payload = {
        title: uploadTitle.trim() ? uploadTitle.trim() : undefined,
        pdf_url: uploadPdfUrl.trim(),
        pdf_storage_type: uploadStorageType
      };

      const response = await fetch('/agreement/upload', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data?.error || 'Agreement upload failed.');
      }

      const data: AgreementCurrentResponse = await response.json();
      setActiveAgreement(data.agreement);
      if (data.agreement) {
        setPlacement({
          x: data.agreement.x,
          y: data.agreement.y,
          width: data.agreement.width,
          height: data.agreement.height
        });
        setPageNumber(data.agreement.page_number || 1);
        setPlacementDirty(false);
        setPlacementError(null);
      }
      setUploadModalOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agreement upload failed.';
      setUploadError(message);
    } finally {
      setUploading(false);
    }
  };

  const handleSavePlacement = async () => {
    if (!activeAgreement) return;
    setPlacementSaving(true);
    setPlacementError(null);
    try {
      const payload = {
        agreement_id: activeAgreement.id,
        page_number: pageNumber,
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height
      };

      const response = await fetch('/agreement/placement', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data?.error || 'Failed to save placement.');
      }

      setPlacementDirty(false);
      await loadAgreement();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save placement.';
      setPlacementError(message);
    } finally {
      setPlacementSaving(false);
    }
  };

  const handleSignedRow = async (id: string) => {
    try {
      const response = await fetch(`/agreement/signed/${id}`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data?.error || 'Failed to load signature.');
      }
      const data: SignedAgreementDetailResponse = await response.json();
      setSignedDetail(data.signed_agreement);
      setSignedDetailAgreement(data.agreement);
      setSignedDetailOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load signature.';
      setSignedError(message);
    }
  };

  const signedRowsMarkup = signedAgreements.map((item, index) => (
    <IndexTable.Row
      id={item.id}
      key={item.id}
      position={index}
      onClick={() => handleSignedRow(item.id)}
    >
      <IndexTable.Cell>{formatDateTime(item.signed_at)}</IndexTable.Cell>
      <IndexTable.Cell>{item.status}</IndexTable.Cell>
      <IndexTable.Cell>{item.order_id || 'N/A'}</IndexTable.Cell>
      <IndexTable.Cell>{item.customer_email || 'N/A'}</IndexTable.Cell>
      <IndexTable.Cell>v{item.agreement_version}</IndexTable.Cell>
    </IndexTable.Row>
  ));

  const placementPixelRect = useMemo(() => {
    const container = overlayRef.current;
    if (!container) return null;
    const rect = rectToPixels(placement, container.clientWidth, container.clientHeight);
    return rect;
  }, [placement, pdfRendering]);

  const renderPage = useCallback(async () => {
    const pdfDoc = pdfDocRef.current;
    const canvas = canvasRef.current;
    const container = overlayRef.current;
    if (!pdfDoc || !canvas || !container) return;

    setPdfRendering(true);
    try {
      const page = await pdfDoc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const maxWidth = Math.max(320, container.clientWidth);
      const scale = maxWidth / viewport.width;
      const scaledViewport = page.getViewport({ scale });
      const context = canvas.getContext('2d');
      if (!context) return;

      canvas.width = scaledViewport.width;
      canvas.height = scaledViewport.height;
      container.style.height = `${scaledViewport.height}px`;

      await page.render({ canvasContext: context, viewport: scaledViewport, canvas }).promise;
    } finally {
      setPdfRendering(false);
    }
  }, [pageNumber]);

  useEffect(() => {
    let cancelled = false;

    const loadPdf = async () => {
      if (!activeAgreement?.pdf_url) {
        pdfDocRef.current = null;
        return;
      }
      try {
        const loadingTask = getDocument({ url: activeAgreement.pdf_url }) as PDFDocumentLoadingTask;
        const doc = await loadingTask.promise;
        if (cancelled) return;
        pdfDocRef.current = doc;
        const totalPages = doc.numPages || 1;
        setPdfPages(totalPages);
        setPageNumber((prev) => (prev > totalPages ? 1 : prev));
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Failed to render PDF.';
          setPlacementError(message);
        }
      }
    };

    loadPdf();

    return () => {
      cancelled = true;
    };
  }, [activeAgreement?.pdf_url]);

  useEffect(() => {
    if (pdfDocRef.current) {
      renderPage();
    }
  }, [pageNumber, renderPage, activeAgreement?.pdf_url]);

  useEffect(() => {
    const handleResize = () => {
      if (pdfDocRef.current) {
        renderPage();
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [renderPage]);

  const beginDrag = (mode: DragMode, event: ReactPointerEvent<HTMLDivElement>) => {
    const container = overlayRef.current;
    if (!container) return;

    const rectPx = rectToPixels(placement, container.clientWidth, container.clientHeight);
    dragStateRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startRect: rectPx
    };

    container.setPointerCapture(event.pointerId);
  };

  const updateDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    const container = overlayRef.current;
    if (!dragState || !container) return;

    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    let { left, top, width, height } = dragState.startRect;

    if (dragState.mode === 'move') {
      left = clamp(left + dx, 0, container.clientWidth - width);
      top = clamp(top + dy, 0, container.clientHeight - height);
    } else {
      if (dragState.mode === 'resize-se' || dragState.mode === 'resize-ne') {
        width = clamp(width + dx, MIN_RECT_SIZE_PX, container.clientWidth - left);
      }
      if (dragState.mode === 'resize-se' || dragState.mode === 'resize-sw') {
        height = clamp(height + dy, MIN_RECT_SIZE_PX, container.clientHeight - top);
      }
      if (dragState.mode === 'resize-nw' || dragState.mode === 'resize-sw') {
        const newLeft = clamp(left + dx, 0, left + width - MIN_RECT_SIZE_PX);
        width = clamp(width + (left - newLeft), MIN_RECT_SIZE_PX, container.clientWidth - newLeft);
        left = newLeft;
      }
      if (dragState.mode === 'resize-nw' || dragState.mode === 'resize-ne') {
        const newTop = clamp(top + dy, 0, top + height - MIN_RECT_SIZE_PX);
        height = clamp(height + (top - newTop), MIN_RECT_SIZE_PX, container.clientHeight - newTop);
        top = newTop;
      }
    }

    const normalized = normalizeRect({ left, top, width, height }, container.clientWidth, container.clientHeight);
    setPlacement(normalized);
    setPlacementDirty(true);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const container = overlayRef.current;
    if (!container) return;
    dragStateRef.current = null;
    container.releasePointerCapture(event.pointerId);
  };

  return (
    <Page title="Agreement" subtitle="Require a signed agreement before checkout for rentable carts.">
      <Layout>
        <Layout.Section>
          <Card padding="400">
            <BlockStack gap="300">
              <InlineStack align="space-between">
                <Text variant="headingMd" as="h2">Active Agreement</Text>
                <Button onClick={openUploadModal} variant="primary">Upload New Agreement</Button>
              </InlineStack>

              {agreementLoading && (
                <InlineStack gap="200" align="start">
                  <Spinner size="small" />
                  <Text as="span">Loading agreement...</Text>
                </InlineStack>
              )}

              {agreementError && <InlineError message={agreementError} fieldID="agreement-error" />}

              {!agreementLoading && !activeAgreement && (
                <Text as="p">No active agreement uploaded yet.</Text>
              )}

              {activeAgreement && (
                <BlockStack gap="200">
                  <InlineStack gap="200" align="start">
                    <Badge tone="success">Active</Badge>
                    <Text as="span">v{activeAgreement.version}</Text>
                  </InlineStack>
                  <Text as="p">{activeAgreement.title || 'Untitled Agreement'}</Text>
                  <Text as="p">Uploaded {formatDateTime(activeAgreement.created_at)}</Text>
                  <InlineStack gap="200">
                    <Button url={activeAgreement.pdf_url} external>Preview / Download PDF</Button>
                  </InlineStack>
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card padding="400">
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Signature Placement Editor</Text>
              {!activeAgreement && (
                <Text as="p">Upload an agreement to configure signature placement.</Text>
              )}

              {activeAgreement && (
                <BlockStack gap="200">
                  <InlineStack gap="200" align="start">
                    <TextField
                      label="Page"
                      type="number"
                      min={1}
                      max={pdfPages}
                      value={pageNumber.toString()}
                      onChange={(value) => setPageNumber(Math.max(1, Number(value) || 1))}
                      autoComplete="off"
                    />
                    <Text as="span">of {pdfPages}</Text>
                  </InlineStack>

                  {placementError && <InlineError message={placementError} fieldID="placement-error" />}

                  <Box>
                    <div
                      ref={overlayRef}
                      style={{
                        position: 'relative',
                        width: '100%',
                        maxWidth: '820px',
                        margin: '0 auto',
                        border: '1px solid #dfe3e8',
                        borderRadius: '12px',
                        overflow: 'hidden',
                        background: '#f8f9fb'
                      }}
                      onPointerMove={updateDrag}
                      onPointerUp={endDrag}
                    >
                      <canvas ref={canvasRef} style={{ display: 'block', width: '100%' }} />
                      {placementPixelRect && (
                        <div
                          style={{
                            position: 'absolute',
                            left: placementPixelRect.left,
                            top: placementPixelRect.top,
                            width: placementPixelRect.width,
                            height: placementPixelRect.height,
                            border: '2px solid #2c6ecb',
                            background: 'rgba(44, 110, 203, 0.12)',
                            boxSizing: 'border-box',
                            cursor: 'move'
                          }}
                          onPointerDown={(event) => beginDrag('move', event)}
                        >
                          {(['resize-nw', 'resize-ne', 'resize-sw', 'resize-se'] as DragMode[]).map((mode) => {
                            const isLeft = mode.endsWith('w');
                            const isTop = mode.startsWith('resize-n');
                            return (
                              <div
                                key={mode}
                                onPointerDown={(event) => {
                                  event.stopPropagation();
                                  beginDrag(mode, event);
                                }}
                                style={{
                                  position: 'absolute',
                                  width: '12px',
                                  height: '12px',
                                  borderRadius: '50%',
                                  border: '2px solid #2c6ecb',
                                  background: '#ffffff',
                                  cursor: `${isLeft ? 'nw' : 'ne'}-resize`,
                                  top: isTop ? '-6px' : undefined,
                                  bottom: isTop ? undefined : '-6px',
                                  left: isLeft ? '-6px' : undefined,
                                  right: isLeft ? undefined : '-6px'
                                }}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </Box>

                  <InlineStack gap="200">
                    <Button
                      onClick={handleSavePlacement}
                      variant="primary"
                      disabled={!placementDirty || placementSaving}
                      loading={placementSaving}
                    >
                      Save Placement
                    </Button>
                    {pdfRendering && <Text as="span">Rendering PDF...</Text>}
                  </InlineStack>
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card padding="400">
            <BlockStack gap="300">
              <InlineStack align="space-between">
                <Text variant="headingMd" as="h2">Signed Agreements</Text>
                <Button onClick={loadSignedAgreements}>Refresh</Button>
              </InlineStack>

              <InlineStack gap="200" wrap>
                <TextField
                  label="Order ID"
                  value={filterOrderId}
                  onChange={setFilterOrderId}
                  autoComplete="off"
                />
                <TextField
                  label="Customer Email"
                  value={filterEmail}
                  onChange={setFilterEmail}
                  autoComplete="off"
                />
                <TextField
                  label="Start Date"
                  type="date"
                  value={filterStartDate}
                  onChange={setFilterStartDate}
                  autoComplete="off"
                />
                <TextField
                  label="End Date"
                  type="date"
                  value={filterEndDate}
                  onChange={setFilterEndDate}
                  autoComplete="off"
                />
                <Select
                  label="Status"
                  options={[
                    { label: 'Any', value: '' },
                    { label: 'Pending', value: 'pending' },
                    { label: 'Linked', value: 'linked_to_order' },
                    { label: 'Expired', value: 'expired' }
                  ]}
                  value={filterStatus}
                  onChange={setFilterStatus}
                />
              </InlineStack>

              {signedError && <InlineError message={signedError} fieldID="signed-error" />}

              <IndexTable
                resourceName={{ singular: 'signed agreement', plural: 'signed agreements' }}
                itemCount={signedAgreements.length}
                selectable={false}
                loading={signedLoading}
                headings={[
                  { title: 'Signed At' },
                  { title: 'Status' },
                  { title: 'Order ID' },
                  { title: 'Email' },
                  { title: 'Agreement' }
                ]}
              >
                {signedRowsMarkup}
              </IndexTable>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      <Modal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        title="Upload New Agreement"
        primaryAction={{
          content: 'Save Agreement',
          onAction: handleUpload,
          loading: uploading
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setUploadModalOpen(false)
          }
        ]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            {uploadError && <InlineError message={uploadError} fieldID="upload-error" />}
            <TextField
              label="Title"
              value={uploadTitle}
              onChange={setUploadTitle}
              autoComplete="off"
            />
            <TextField
              label="PDF URL"
              value={uploadPdfUrl}
              onChange={setUploadPdfUrl}
              autoComplete="off"
              helpText="Upload the PDF to Shopify Files or another public URL, then paste the link here."
            />
            <Select
              label="Storage Type"
              options={[
                { label: 'External URL', value: 'EXTERNAL' },
                { label: 'Shopify Files URL', value: 'SHOPIFY_FILES' }
              ]}
              value={uploadStorageType}
              onChange={setUploadStorageType}
            />
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={signedDetailOpen}
        onClose={() => setSignedDetailOpen(false)}
        title="Signed Agreement"
        size="fullScreen"
      >
        <Modal.Section>
          {signedDetail && signedDetailAgreement ? (
            <BlockStack gap="200">
              <Text as="p">Signed at {formatDateTime(signedDetail.signed_at)}</Text>
              <Text as="p">Order ID: {signedDetail.order_id || 'N/A'}</Text>
              <Text as="p">Email: {signedDetail.customer_email || 'N/A'}</Text>
              <Text as="p">Agreement v{signedDetail.agreement_version}</Text>

              <InlineStack gap="200" wrap>
                <Button url={signedDetailAgreement.pdf_url} external>
                  Download Original PDF
                </Button>
              </InlineStack>

              {signedDetail.signature_png_base64 ? (
                <a
                  href={signedDetail.signature_png_base64}
                  download={`agreement-signature-${signedDetail.id}.png`}
                >
                  Download Signature PNG
                </a>
              ) : null}

              {signedDetail.signature_png_base64 ? (
                <SignedAgreementPdfPreview
                  pdfUrl={signedDetailAgreement.pdf_url}
                  signatureDataUrl={signedDetail.signature_png_base64}
                  signaturePageNumber={signedDetailAgreement.page_number || 1}
                  signatureRect={
                    {
                      x: signedDetailAgreement.x,
                      y: signedDetailAgreement.y,
                      width: signedDetailAgreement.width,
                      height: signedDetailAgreement.height,
                    } satisfies NormalizedRect
                  }
                />
              ) : (
                <Text as="p">Signature missing for this agreement.</Text>
              )}
            </BlockStack>
          ) : (
            <Text as="p">Loading signature...</Text>
          )}
        </Modal.Section>
      </Modal>
    </Page>
  );
}
