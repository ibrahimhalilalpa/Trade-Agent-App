import { randomUUID } from 'node:crypto';
import { apiError, apiSuccess, databaseError, requireForumUser } from '@/lib/forum';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
};

async function matchesImageType(file: File) {
    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    switch (file.type) {
        case 'image/jpeg':
            return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
        case 'image/png':
            return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e
                && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a
                && bytes[6] === 0x1a && bytes[7] === 0x0a;
        case 'image/webp':
            return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
                && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
        case 'image/gif':
            return bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(String.fromCharCode(...bytes.slice(0, 6)));
        default:
            return false;
    }
}

export async function POST(request: Request) {
    const auth = await requireForumUser();
    if (auth.response) return auth.response;
    const contentLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_FILE_SIZE + 64 * 1024) {
        return apiError('Görsel boyutu 5 MB sınırını aşamaz.', 413, 'FILE_TOO_LARGE');
    }
    let form: FormData;
    try {
        form = await request.formData();
    } catch {
        return apiError('Dosya yükleme isteği okunamadı.', 400, 'INVALID_FORM');
    }
    const file = form.get('file');
    if (!(file instanceof File)) return apiError('Yüklenecek görsel dosyası bulunamadı.', 400, 'MISSING_FILE');
    const extension = IMAGE_TYPES[file.type];
    if (!extension) return apiError('Yalnızca JPEG, PNG, WebP veya GIF görselleri yüklenebilir.', 415, 'INVALID_MIME_TYPE');
    if (file.size < 1 || file.size > MAX_FILE_SIZE) return apiError('Görsel boyutu 5 MB sınırını aşamaz.', 413, 'FILE_TOO_LARGE');
    if (!await matchesImageType(file)) return apiError('Dosya içeriği bildirilen görsel türüyle eşleşmiyor.', 415, 'INVALID_IMAGE_CONTENT');
    const objectPath = `${auth.user.id}/${randomUUID()}.${extension}`;
    const { error } = await auth.client.storage.from('community-media').upload(objectPath, file, {
        contentType: file.type,
        cacheControl: '3600',
        upsert: false,
    });
    if (error) return databaseError(error, 'Görsel yüklenemedi.');
    const { data } = auth.client.storage.from('community-media').getPublicUrl(objectPath);
    return apiSuccess({ path: objectPath, url: data.publicUrl }, 201);
}
