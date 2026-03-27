import imageCompression from 'browser-image-compression';

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

const COMPRESSION_OPTIONS = {
    maxSizeMB: 0.3,          // 최대 300KB
    maxWidthOrHeight: 1200,   // 최대 1200px
    useWebWorker: true,
    fileType: 'image/webp',   // webp로 변환 (더 작은 용량)
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

    if (!response.ok) {
        throw new Error('이미지 업로드에 실패했습니다.');
    }

    const data = await response.json();
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
