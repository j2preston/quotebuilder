import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { v4 as uuid } from 'uuid';

let _blobClient: BlobServiceClient | null = null;

function getBlobClient(): BlobServiceClient {
  if (!_blobClient) {
    _blobClient = BlobServiceClient.fromConnectionString(
      process.env.AZURE_STORAGE_CONNECTION_STRING!
    );
  }
  return _blobClient;
}

export async function uploadVoiceNote(
  buffer: Buffer,
  mimetype: string,
  traderId: string
): Promise<string> {
  const ext = mimetype.split('/')[1]?.replace('x-', '') ?? 'bin';
  const blobName = `${traderId}/${uuid()}.${ext}`;
  const containerClient = getBlobClient().getContainerClient(
    process.env.AZURE_STORAGE_CONTAINER_VOICE ?? 'voice-notes'
  );

  const blockBlob = containerClient.getBlockBlobClient(blobName);
  await blockBlob.upload(buffer, buffer.length, {
    blobHTTPHeaders: { blobContentType: mimetype },
  });

  return blobName;
}

export async function uploadPdf(
  buffer: Buffer,
  traderId: string,
  quoteId: string
): Promise<string> {
  const blobName = `${traderId}/${quoteId}.pdf`;
  const containerClient = getBlobClient().getContainerClient(
    process.env.AZURE_STORAGE_CONTAINER_PDFS ?? 'quote-pdfs'
  );

  const blockBlob = containerClient.getBlockBlobClient(blobName);
  await blockBlob.upload(buffer, buffer.length, {
    blobHTTPHeaders: { blobContentType: 'application/pdf' },
  });

  return blockBlob.url;
}

export async function downloadBlob(containerName: string, blobName: string): Promise<Buffer> {
  const containerClient = getBlobClient().getContainerClient(containerName);
  const blockBlob = containerClient.getBlockBlobClient(blobName);
  const downloadResponse = await blockBlob.download(0);

  const chunks: Buffer[] = [];
  for await (const chunk of downloadResponse.readableStreamBody as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
