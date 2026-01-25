import { BlockStack, Box, InlineError, InlineStack, Spinner, Text } from '@shopify/polaris';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SignedAgreementPdfPreviewProps {
  pdfUrl: string;
  signatureDataUrl: string;
  signaturePageNumber: number;
  signatureRect: NormalizedRect;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function SignedAgreementPdfPreview({
  pdfUrl,
  signatureDataUrl,
  signaturePageNumber,
  signatureRect,
}: SignedAgreementPdfPreviewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const renderTasks = useRef<Map<number, RenderTask>>(new Map());
  const [pageSizes, setPageSizes] = useState<Record<number, { width: number; height: number }>>({});
  const [canvasesReady, setCanvasesReady] = useState(false);

  // Load PDF document
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPdfDoc(null);
    setPageCount(0);
    setPageSizes({});
    setCanvasesReady(false);
    canvasRefs.current.clear();

    const load = async () => {
      if (!pdfUrl) {
        setError('No PDF URL provided.');
        setLoading(false);
        return;
      }

      console.log('[SignedAgreementPdfPreview] Loading PDF from:', pdfUrl);

      try {
        // Use withCredentials: false to avoid CORS preflight for Shopify CDN
        const loadingTask = getDocument({
          url: pdfUrl,
          withCredentials: false,
        }) as PDFDocumentLoadingTask;
        const doc = await loadingTask.promise;
        if (cancelled) return;
        console.log('[SignedAgreementPdfPreview] PDF loaded, pages:', doc.numPages);
        setPdfDoc(doc);
        setPageCount(doc.numPages || 1);
      } catch (e) {
        if (cancelled) return;
        console.error('[SignedAgreementPdfPreview] PDF load error:', e);
        const message = e instanceof Error ? e.message : 'Failed to load PDF.';
        // Provide more helpful error for CORS issues
        if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
          setError(`Failed to load PDF (CORS/network error). The PDF URL may not allow cross-origin requests: ${pdfUrl}`);
        } else {
          setError(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

  // Track container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateWidth = () => {
      const width = Math.floor(el.getBoundingClientRect().width);
      if (width > 0) {
        setContainerWidth(width);
      }
    };

    // Initial measurement after a short delay to ensure layout is complete
    const timeoutId = setTimeout(updateWidth, 50);

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => {
        clearTimeout(timeoutId);
        window.removeEventListener('resize', updateWidth);
      };
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = Math.floor(entry.contentRect.width);
        if (width > 0) {
          setContainerWidth(width);
        }
      }
    });

    observer.observe(el);
    return () => {
      clearTimeout(timeoutId);
      observer.disconnect();
    };
  }, [pageCount]); // Re-run when pageCount changes (container re-renders)

  // Canvas ref callback - stores ref without triggering re-renders
  const setCanvasRef = useCallback((pageNumber: number, node: HTMLCanvasElement | null) => {
    if (node) {
      canvasRefs.current.set(pageNumber, node);
    } else {
      canvasRefs.current.delete(pageNumber);
    }
  }, []);

  // Check if all canvases are mounted after pageCount changes
  useEffect(() => {
    if (pageCount > 0 && !canvasesReady) {
      // Use a small delay to let React finish mounting the canvases
      const timeoutId = setTimeout(() => {
        if (canvasRefs.current.size >= pageCount) {
          setCanvasesReady(true);
        }
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [pageCount, canvasesReady]);

  // Render all PDF pages
  useEffect(() => {
    let cancelled = false;

    // Cleanup active render tasks on unmount or re-render
    const cleanup = () => {
      cancelled = true;
      renderTasks.current.forEach((task) => {
        try {
          task.cancel();
        } catch {
          // Ignore cancellation errors
        }
      });
      renderTasks.current.clear();
    };

    const renderAll = async () => {
      if (!pdfDoc) return;
      if (!containerWidth || containerWidth < 100) return;
      if (!canvasesReady) return; // Wait for canvases to be ready

      const targetWidth = clamp(containerWidth - 24, 320, 980); // Account for padding

      try {
        const newPageSizes: Record<number, { width: number; height: number }> = {};
        
        for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
          if (cancelled) return;

          const canvas = canvasRefs.current.get(pageNumber);
          if (!canvas) continue;

          // Cancel any existing render task for this page
          const existingTask = renderTasks.current.get(pageNumber);
          if (existingTask) {
            try {
              existingTask.cancel();
            } catch {
              // Ignore cancellation errors
            }
            renderTasks.current.delete(pageNumber);
          }

          const page = await pdfDoc.getPage(pageNumber);
          if (cancelled) return;

          const viewport = page.getViewport({ scale: 1 });
          const scale = targetWidth / viewport.width;
          const scaledViewport = page.getViewport({ scale });

          canvas.width = Math.floor(scaledViewport.width);
          canvas.height = Math.floor(scaledViewport.height);

          const ctx = canvas.getContext('2d');
          if (!ctx) continue;

          const renderTask = page.render({ canvasContext: ctx, viewport: scaledViewport, canvas });
          renderTasks.current.set(pageNumber, renderTask);

          try {
            await renderTask.promise;
          } catch (err: unknown) {
            // Check formatted error string to ignore cancellation errors safely
            // pdf.js throws an Object with name 'RenderingCancelledException' when cancelled
            if (
              err instanceof Error && err.message.includes('cancelled') || 
              (typeof err === 'object' && err !== null && (err as {name?: string}).name === 'RenderingCancelledException')
            ) {
              // Render cancelled, do nothing
              return;
            }
            throw err;
          } finally {
            renderTasks.current.delete(pageNumber);
          }

          if (cancelled) return;
          newPageSizes[pageNumber] = { width: canvas.width, height: canvas.height };
        }
        
        // Update all page sizes in a single setState call to avoid multiple re-renders
        if (!cancelled && Object.keys(newPageSizes).length > 0) {
          setPageSizes(newPageSizes);
        }
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : 'Failed to render PDF.';
        // Don't show error if it's just a cancellation
        if (message.includes('cancelled') || message.includes('RenderingCancelledException')) return;
        setError(message);
      }
    };

    void renderAll();

    return cleanup;
  }, [pdfDoc, pageCount, containerWidth, canvasesReady]);

  const signatureStyle = useMemo(() => {
    const size = pageSizes[signaturePageNumber];
    if (!size) return null;
    return {
      left: `${signatureRect.x * size.width}px`,
      top: `${signatureRect.y * size.height}px`,
      width: `${signatureRect.width * size.width}px`,
      height: `${signatureRect.height * size.height}px`,
    };
  }, [pageSizes, signaturePageNumber, signatureRect]);

  if (loading) {
    return (
      <InlineStack gap="200" align="start" blockAlign="center">
        <Spinner size="small" />
        <Text as="span">Loading PDF…</Text>
      </InlineStack>
    );
  }

  if (error) {
    return <InlineError message={error} fieldID="signed-agreement-pdf-error" />;
  }

  if (!pdfDoc || pageCount < 1) {
    return <Text as="p">PDF unavailable.</Text>;
  }

  return (
    <BlockStack gap="400">
      <Box>
        <div
          ref={containerRef}
          style={{
            width: '100%',
            maxWidth: 980,
            margin: '0 auto',
            background: '#f8f9fb',
            borderRadius: 12,
            padding: 12,
            border: '1px solid #e1e3e5',
          }}
        >
          <BlockStack gap="400">
            {Array.from({ length: pageCount }).map((_, index) => {
              const pageNumber = index + 1;
              return (
                <div
                  key={pageNumber}
                  style={{
                    position: 'relative',
                    background: 'white',
                    borderRadius: 10,
                    overflow: 'hidden',
                    border: '1px solid #e1e3e5',
                    minHeight: 200,
                  }}
                >
                  <canvas
                    ref={(node) => setCanvasRef(pageNumber, node)}
                    style={{ display: 'block', width: '100%', height: 'auto' }}
                  />

                  {pageNumber === signaturePageNumber && signatureStyle && signatureDataUrl && (
                    <img
                      src={signatureDataUrl}
                      alt="Customer signature"
                      style={{
                        position: 'absolute',
                        ...signatureStyle,
                        objectFit: 'contain',
                        pointerEvents: 'none',
                      }}
                    />
                  )}
                </div>
              );
            })}
          </BlockStack>
        </div>
      </Box>
    </BlockStack>
  );
}
