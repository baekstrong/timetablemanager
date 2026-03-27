import imageCompression from 'browser-image-compression';

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

const COMPRESSION_OPTIONS = {
    maxSizeMB: 1,             // 최대 1MB
    maxWidthOrHeight: 1920,   // 최대 1920px
    useWebWorker: true,
};

export const compressImage = async (file) => {
    try {
        const compressed = await imageCompression(file, COMPRESSION_OPTIONS);
        return compressed;
    } catch (error) {
        console.error('이미지 압축 실패:', error);
        return file; // 실패 시 원본 반환
    }
};

export const uploadToCloudinary = async (file) => {
    if (!CLOUD_NAME || !UPLOAD_PRESET) {
        throw new Error('Cloudinary 환경변수가 설정되지 않았습니다.');
    }

    const compressed = await compressImage(file);

    const formData = new FormData();
    formData.append('file', compressed);
    formData.append('upload_preset', UPLOAD_PRESET);
    formData.append('folder', 'board');

    const response = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
        { method: 'POST', body: formData }
    );

    const data = await response.json();

    if (!response.ok) {
        console.error('Cloudinary 업로드 실패:', data);
        throw new Error(data?.error?.message || '이미지 업로드에 실패했습니다.');
    }
    return {
        url: data.secure_url,
        publicId: data.public_id,
        width: data.width,
        height: data.height,
    };
};

export const uploadMultipleImages = async (files, onProgress) => {
    const results = [];
    for (let i = 0; i < files.length; i++) {
        const result = await uploadToCloudinary(files[i]);
        results.push(result);
        onProgress?.(i + 1, files.length);
    }
    return results;
};
