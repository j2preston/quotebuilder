import { BlobServiceClient, BlobSASPermissions } from '@azure/storage-blob';

// ─── Singleton client ─────────────────────────────────────────────────────────

let _client: BlobServiceClient | null = null;

function getClient(): BlobServiceClient {
  if (!_client) {
    const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connStr) throw new Error('AZURE_STORAGE_CONNECTION_STRING is not set');
    _client = BlobServiceClient.fromConnectionString(connStr);
  }
  return _client;
}

// Container name comes from env: quotebot-quotes-development / quotebot-quotes-production
function containerName(): string {
  return process.env.AZURE_STORAGE_CONTAINER ?? `quotebot-quotes-${process.env.NODE_ENV ?? 'development'}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Upload a PDF buffer to Azure Blob Storage.
 * Blob path: quotes/{traderId}/{quoteId}.pdf
 *
 * @returns SAS URL valid for 7 days (read-only)
 */
export async function uploadQuotePdf(
  buffer: Buffer,
  traderId: string,
  quoteId: string,
): Promise<string> {
  const blobPath      = `quotes/${traderId}/${quoteId}.pdf`;
  const containerClient = getClient().getContainerClient(containerName());

  // Ensure container exists (no-op if already present)
  await containerClient.createIfNotExists(); // no access param = private

  const blobClient = containerClient.getBlockBlobClient(blobPath);

  await blobClient.upload(buffer, buffer.length, {
    blobHTTPHeaders: {
      blobContentType:        'application/pdf',
      blobContentDisposition: `inline; filename="${quoteId}.pdf"`,
    },
  });

  // Generate a read-only SAS URL valid for 7 days
  const expiresOn = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const sasUrl = await blobClient.generateSasUrl({
    permissions: BlobSASPermissions.parse('r'),
    expiresOn,
  });

  return sasUrl;
}
