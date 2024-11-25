// SVG 转换为 Base64
const svgToBase64 = (svgString: string): string => {
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgString)))}`;
};

// 处理图像转换
const processImage = async (svgString: string, width: number, height: number): Promise<string> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const svgBase64 = svgToBase64(svgString);

        img.onerror = () => {
            reject(new Error('SVG 加载失败'));
        };

        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('无法创建 canvas context'));
                return;
            }

            try {
                // 保持宽高比
                const scale = Math.min(width / img.width, height / img.height);
                const scaledWidth = img.width * scale;
                const scaledHeight = img.height * scale;

                // 居中绘制
                const x = (width - scaledWidth) / 2;
                const y = (height - scaledHeight) / 2;

                // 使用高质量的缩放
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';

                // 绘制图像
                ctx.drawImage(img, x, y, scaledWidth, scaledHeight);

                // 转换为 PNG 的 base64
                const pngBase64 = canvas.toDataURL('image/png');
                resolve(pngBase64);
            } catch (error) {
                reject(error);
            }
        };

        img.src = svgBase64;
    });
};

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.target === 'offscreen' && message.type === 'convert-svg') {
        try {
            const dataUrl = await processImage(
                message.data.svgString,
                message.data.width,
                message.data.height
            );
            sendResponse({ success: true, dataUrl });
        } catch (error) {
            sendResponse({
                success: false,
                error: error instanceof Error ? error.message : '未知错误'
            });
        }
        return true;
    }
}); 