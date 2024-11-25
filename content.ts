// 添加节流函数来优化性能
const throttle = <T extends (...args: any[]) => any>(func: T, limit: number) => {
    let inThrottle: boolean;
    return function (this: any, ...args: Parameters<T>) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
};

// 优化扫描函数, 添加缓存机制
const scanSVGElements = (() => {
    let cachedElements: SVGElement[] | null = null;
    let lastScanTime = 0;
    const CACHE_DURATION = 1000; // 1秒缓存

    return () => {
        const now = Date.now();
        if (cachedElements && (now - lastScanTime) < CACHE_DURATION) {
            return cachedElements;
        }

        const svgElements: SVGElement[] = [];

        // 扫描常规 DOM
        const scanRegularDOM = (root: Document | Element | ShadowRoot) => {
            const elements = root.querySelectorAll('svg');
            elements.forEach(svg => {
                if (svg instanceof SVGElement) {
                    svgElements.push(svg);
                }
            });
        };

        // 扫描 Shadow DOM
        const scanShadowDOM = (root: Element) => {
            if (root.shadowRoot) {
                scanRegularDOM(root.shadowRoot);
                const elements = root.shadowRoot.querySelectorAll('*');
                elements.forEach(el => {
                    if (el instanceof Element && el.shadowRoot) {
                        scanShadowDOM(el);
                    }
                });
            }
        };

        // 扫描 iframes
        const scanIframes = () => {
            const iframes = document.querySelectorAll('iframe');
            iframes.forEach(iframe => {
                try {
                    const iframeDoc = iframe.contentDocument;
                    if (iframeDoc) {
                        scanRegularDOM(iframeDoc);
                        const elements = iframeDoc.querySelectorAll('*');
                        elements.forEach(el => {
                            if (el instanceof Element) {
                                scanShadowDOM(el);
                            }
                        });
                    }
                } catch (e) {
                    console.warn('无法访问 iframe 内容:', e);
                }
            });
        };

        // 执行所有扫描
        scanRegularDOM(document);
        document.querySelectorAll('*').forEach(el => scanShadowDOM(el));
        scanIframes();

        cachedElements = svgElements;
        lastScanTime = now;
        return svgElements;
    };
})();

// 添加获取 SVG 尺寸的辅助函数
const getSVGDimensions = (svg: SVGElement) => {
    // 尝试从 width/height 属性获取
    let width = svg.getAttribute('width');
    let height = svg.getAttribute('height');

    // 尝试从 viewBox 获取
    if ((!width || !height) && svg.getAttribute('viewBox')) {
        const viewBox = svg.getAttribute('viewBox')?.split(' ');
        if (viewBox && viewBox.length === 4) {
            width = viewBox[2];
            height = viewBox[3];
        }
    }

    // 尝试从 style 获取
    if (!width || !height) {
        const style = window.getComputedStyle(svg);
        width = style.width;
        height = style.height;
    }

    // 尝试从 getBBox 获取
    if (!width || !height) {
        try {
            const bbox = svg.getBBox();
            width = bbox.width.toString();
            height = bbox.height.toString();
        } catch (e) {
            console.warn('无法获取 SVG bbox:', e);
        }
    }

    // 解析尺寸，移除单位（如 px）
    const parseSize = (size: string | null) => {
        if (!size) return 0;
        const match = size.match(/^([\d.]+)/);
        return match ? parseFloat(match[1]) : 0;
    };

    return {
        width: parseSize(width) || svg.clientWidth || 100,  // 提供默认值
        height: parseSize(height) || svg.clientHeight || 100
    };
};

// 修改消息监听器
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'scanSVG') {
        const svgElements = scanSVGElements();
        const svgData = svgElements.map((svg, index) => ({
            id: index,
            outerHTML: svg.outerHTML,
            dimensions: getSVGDimensions(svg)
        }));

        console.log('扫描到的 SVG 尺寸:', svgData.map(item => ({
            id: item.id,
            dimensions: item.dimensions
        })));

        sendResponse({ svgData });
        return true;
    }
}); 