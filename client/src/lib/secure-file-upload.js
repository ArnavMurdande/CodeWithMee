import apiClient from './api';

export async function uploadSecureFile(file, purpose, { ownerOrganizationId, ownerType = 'user', makePublic = false } = {}) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const intent = await apiClient.post('/api/v1/files/upload-intents', {
    byteSize: file.size,
    declaredMime: file.type || 'application/octet-stream',
    originalName: file.name,
    ownerOrganizationId,
    ownerType,
    purpose,
    sha256,
  });
  const { file: fileRecord, upload } = intent.data;
  const headers = { ...(upload.requiredHeaders || {}) };
  delete headers['content-length'];
  const uploaded = await fetch(upload.url, { method: 'PUT', body: file, headers });
  if (!uploaded.ok) throw new Error('object_upload_failed');
  await apiClient.post(`/api/v1/files/${fileRecord.id}/complete`, {});
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const metadata = await apiClient.get(`/api/v1/files/${fileRecord.id}`);
    if (metadata.data.file?.state === 'ready' && metadata.data.file?.scanStatus === 'clean') {
      if (makePublic) await apiClient.patch(`/api/v1/files/${fileRecord.id}/visibility`, { visibility: 'public' });
      return fileRecord.id;
    }
    if (metadata.data.file?.state === 'quarantined') throw new Error('file_quarantined');
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }
  throw new Error('file_scan_pending');
}
