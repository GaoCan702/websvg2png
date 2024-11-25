import React, { useState, useEffect, useCallback, useRef, useMemo } from "react"
import JSZip from "jszip"
import "./sidepanel.css"
import { NumericFormat } from 'react-number-format';

interface SVGItem {
    id: number;
    outerHTML: string;
    dimensions: {
        width: number;
        height: number;
    };
}

// 修改预设尺寸选项
const PRESET_SIZES = [
    { width: 16, height: 16, label: '16x16' },
    { width: 32, height: 32, label: '32x32' },
    { width: 48, height: 48, label: '48x48' },
    { width: 128, height: 128, label: '128x128' },
    { label: '原始尺寸', width: 0, height: 0 },
    { label: '下载所有尺寸', width: -1, height: -1 },
    { label: '自定义尺寸', width: -2, height: -2 }  // 添加自定义尺寸选项
] as const;

interface DownloadStatus {
    [key: number]: {
        loading: boolean;
        error?: string;
    };
}

// 添加错误边界组件
class ErrorBoundary extends React.Component<
    { children: React.ReactNode },
    { hasError: boolean; error: Error | null }
> {
    constructor(props: { children: React.ReactNode }) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="p-4 bg-red-50 text-red-600">
                    <h2>出错了</h2>
                    <p>{this.state.error?.message}</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="mt-2 bg-red-500 text-white px-3 py-1 rounded"
                    >
                        重新加载
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

// 添加加载状态组件
const LoadingSpinner = () => (
    <div className="text-center py-4">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 rounded-full border-t-transparent mx-auto"></div>
        <p className="mt-2">正在扫描 SVG 元素...</p>
    </div>
);

// 实现一个简单的 debounce 函数
function debounce<T extends (...args: any[]) => any>(
    func: T,
    wait: number
): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout | null = null;

    return (...args: Parameters<T>) => {
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(() => {
            func(...args);
            timeout = null;
        }, wait);
    };
}

// 清理 SVG 字符串
const cleanSvgString = (svgString: string): string => {
    // 移除可能导致问题的属性
    return svgString
        .replace(/\n/g, ' ')                   // 移除换行符
        .replace(/\s+/g, ' ')                  // 合并空格
        .replace(/>\s+</g, '><')              // 移除标签间的空格
        .replace(/xlink:href/g, 'href')       // 替换 xlink:href
        .replace(/xmlns:xlink/g, 'xmlns')     // 替换 xmlns:xlink
        .replace(/<svg/, '<svg xmlns="http://www.w3.org/2000/svg"'); // 确保有 xmlns
};

// 修改 SVG 转换函数
const svgToDataUrl = async (
    svgString: string,
    width: number,
    height: number
): Promise<string> => {
    return new Promise((resolve, reject) => {
        try {
            console.log('原始 SVG:', svgString);

            // 清理 SVG
            const cleanedSvg = cleanSvgString(svgString);
            console.log('清理后的 SVG:', cleanedSvg);

            // 解析 SVG
            const parser = new DOMParser();
            const doc = parser.parseFromString(cleanedSvg, 'image/svg+xml');
            const parserError = doc.querySelector('parsererror');

            if (parserError) {
                console.error('SVG 解析错误:', parserError.textContent);
                reject(new Error('SVG 解析失败'));
                return;
            }

            const svgElement = doc.documentElement;

            // 设置视口属
            svgElement.setAttribute('width', width.toString());
            svgElement.setAttribute('height', height.toString());
            svgElement.setAttribute('viewBox', `0 0 ${width} ${height}`);

            // 序列化并编码
            const serializer = new XMLSerializer();
            const svgData = serializer.serializeToString(svgElement);

            // 使用 encodeURIComponent 处理特殊字符
            const encoded = encodeURIComponent(svgData)
                .replace(/%([0-9A-F]{2})/g,
                    (match, p1) => String.fromCharCode(parseInt(p1, 16)));

            const base64 = btoa(encoded);
            const dataUrl = `data:image/svg+xml;base64,${base64}`;

            console.log('生成的 data URL 前缀:', dataUrl.substring(0, 100));

            // 创建图片
            const img = new Image();

            img.onload = () => {
                console.log('图片加载成功:', {
                    naturalWidth: img.naturalWidth,
                    naturalHeight: img.naturalHeight
                });

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('无法创建 canvas context'));
                    return;
                }

                // 绘制图像
                ctx.fillStyle = 'white';  // 设置白色背景
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);

                const pngUrl = canvas.toDataURL('image/png');
                resolve(pngUrl);
            };

            img.onerror = (error) => {
                console.error('图片加载详细错误:', {
                    error,
                    imgSrc: dataUrl.substring(0, 100) + '...',
                    svgSize: svgData.length,
                    base64Size: base64.length
                });
                reject(new Error('SVG 图片加载失败'));
            };

            img.src = dataUrl;

        } catch (error) {
            console.error('SVG 处理过程中的详细错误:', error);
            reject(new Error('SVG 处理失败'));
        }
    });
};

// 修改 downloadAllSizes 函数
const downloadAllSizes = async (svg: SVGItem) => {
    const zip = new JSZip();
    const sizes = PRESET_SIZES.filter(size => size.width >= 0);

    try {
        // 创建所有尺寸的 PNG
        const promises = sizes.map(async (size) => {
            const width = size.width || svg.dimensions.width;
            const height = size.height || svg.dimensions.height;

            const dataUrl = await svgToDataUrl(svg.outerHTML, width, height);
            const base64Data = dataUrl.split(',')[1];
            const filename = `svg_${svg.id}_${width}x${height}.png`;

            zip.file(filename, base64Data, { base64: true });
        });

        await Promise.all(promises);

        // 生成 zip 文件
        const content = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(content);

        await chrome.downloads.download({
            url: url,
            filename: `svg_${svg.id}_all_sizes.zip`,
            saveAs: true
        });

        URL.revokeObjectURL(url);
        return { success: true };
    } catch (error) {
        console.error('批量下载错误:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : '未知错误'
        };
    }
};

// 添加自定义尺寸状态接口
interface CustomSize {
    width: number;
    height: number;
    keepRatio: boolean;
}

export default function SidePanel() {
    const [svgItems, setSvgItems] = useState<SVGItem[]>([]);
    const [isScanning, setIsScanning] = useState(true);
    const [scanError, setScanError] = useState<string | null>(null);
    const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>({});
    const [selectedSizes, setSelectedSizes] = useState<{ [key: number]: typeof PRESET_SIZES[number] }>({});
    const [currentTabId, setCurrentTabId] = useState<number | null>(null);
    const [customSizes, setCustomSizes] = useState<{ [key: number]: CustomSize }>({});

    const CustomSizeInputs = ({ svg }: { svg: SVGItem }) => {
        // 使用 useRef 来存储上一次的值
        const prevSizeRef = useRef<CustomSize | null>(null);
        const [localSize, setLocalSize] = useState(() => {
            return customSizes[svg.id] || {
                width: svg.dimensions.width || 100,
                height: svg.dimensions.height || 100,
                keepRatio: true
            };
        });

        const aspectRatio = useMemo(() =>
            svg.dimensions.width / svg.dimensions.height,
            [svg.dimensions.width, svg.dimensions.height]
        );

        // 使用 useCallback 包装更新函数
        const updateGlobalSize = useCallback((size: CustomSize) => {
            setCustomSizes(prev => ({
                ...prev,
                [svg.id]: size
            }));
        }, [svg.id]);

        // 使用 useEffect 来处理状态同步，但添加防抖
        useEffect(() => {
            // 只在组件挂载时设置初始值
            if (!prevSizeRef.current) {
                prevSizeRef.current = localSize;
                return;
            }

            // 比较新旧值
            const hasChanged =
                prevSizeRef.current.width !== localSize.width ||
                prevSizeRef.current.height !== localSize.height ||
                prevSizeRef.current.keepRatio !== localSize.keepRatio;

            if (hasChanged) {
                const timeoutId = setTimeout(() => {
                    updateGlobalSize(localSize);
                    prevSizeRef.current = localSize;
                }, 300);

                return () => clearTimeout(timeoutId);
            }
        }, [localSize, updateGlobalSize]);

        // 添加临时输入状态
        const [tempInput, setTempInput] = useState({
            width: localSize.width,
            height: localSize.height
        });

        // 处理输入变化
        const handleInputChange = (type: 'width' | 'height', value: number | undefined) => {
            if (value === undefined) return;

            setTempInput(prev => {
                const newValue = Math.max(1, Math.min(9999, value));
                if (type === 'width') {
                    return {
                        ...prev,
                        width: newValue
                    };
                } else {
                    return {
                        ...prev,
                        height: newValue
                    };
                }
            });
        };

        // 处理输入确认
        const handleInputConfirm = (type: 'width' | 'height') => {
            const value = type === 'width' ? tempInput.width : tempInput.height;
            if (!value || value < 1) return;

            setLocalSize(prev => {
                if (type === 'width') {
                    const newWidth = value;
                    return {
                        ...prev,
                        width: newWidth,
                        height: prev.keepRatio ? Math.round(newWidth / aspectRatio) : prev.height
                    };
                } else {
                    const newHeight = value;
                    return {
                        ...prev,
                        height: newHeight,
                        width: prev.keepRatio ? Math.round(newHeight * aspectRatio) : prev.width
                    };
                }
            });
        };

        // 处理按键事件
        const handleKeyDown = (e: React.KeyboardEvent, type: 'width' | 'height') => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleInputConfirm(type);
                // 移除焦点
                (e.target as HTMLElement).blur();
            }
        };

        return (
            <div className="mt-2 p-2 bg-gray-50 rounded border border-gray-200">
                <div className="flex items-center gap-2">
                    <div className="flex-1 flex items-center gap-1">
                        <NumericFormat
                            id={`width-input-${svg.id}`}
                            name={`width-${svg.id}`}
                            value={tempInput.width}
                            onValueChange={({ floatValue }) => handleInputChange('width', floatValue)}
                            onKeyDown={(e) => handleKeyDown(e, 'width')}
                            className="w-20 px-2 py-1 text-sm border rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                            thousandSeparator={false}
                            decimalScale={0}
                            allowNegative={false}
                            isAllowed={(values) => {
                                const { floatValue } = values;
                                return floatValue === undefined || (floatValue >= 1 && floatValue <= 9999);
                            }}
                            placeholder="宽度"
                        />
                        <span className="text-gray-500">×</span>
                        <NumericFormat
                            id={`height-input-${svg.id}`}
                            name={`height-${svg.id}`}
                            value={tempInput.height}
                            onValueChange={({ floatValue }) => handleInputChange('height', floatValue)}
                            onKeyDown={(e) => handleKeyDown(e, 'height')}
                            className="w-20 px-2 py-1 text-sm border rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                            thousandSeparator={false}
                            decimalScale={0}
                            allowNegative={false}
                            isAllowed={(values) => {
                                const { floatValue } = values;
                                return floatValue === undefined || (floatValue >= 1 && floatValue <= 9999);
                            }}
                            placeholder="高度"
                        />
                        <span className="text-gray-400 text-sm">px</span>
                    </div>
                    <button
                        onClick={() => {
                            setLocalSize(prev => ({
                                ...prev,
                                keepRatio: !prev.keepRatio,
                                height: !prev.keepRatio ? Math.round(prev.width / aspectRatio) : prev.height
                            }));
                        }}
                        className={`p-1 rounded hover:bg-gray-200 transition-colors ${localSize.keepRatio ? 'text-blue-500' : 'text-gray-400'
                            }`}
                        title={localSize.keepRatio ? '解除宽高比锁定' : '锁定宽高比'}
                    >
                        {localSize.keepRatio ? '🔒' : '🔓'}
                    </button>
                </div>
                <div className="mt-1 text-xs text-gray-400 flex items-center justify-between">
                    <span>原始尺寸: {svg.dimensions.width}×{svg.dimensions.height}</span>
                    <span className="text-gray-500">按 Enter 键确认输入</span>
                </div>
            </div>
        );
    };

    const handleDownload = async (svg: SVGItem) => {
        const selectedSize = selectedSizes[svg.id] || PRESET_SIZES[0];
        setDownloadStatus(prev => ({
            ...prev,
            [svg.id]: { loading: true }
        }));

        try {
            if (selectedSize.width === -1) {
                // 下载所有尺寸
                const response = await downloadAllSizes(svg);
                if (!response.success) {
                    throw new Error(response.error || '下载失败');
                }
            } else if (selectedSize.width === -2) {
                // 使用自定义尺寸
                const customSize = customSizes[svg.id];
                if (!customSize || customSize.width <= 0 || customSize.height <= 0) {
                    throw new Error('请输入有效的自定义尺寸');
                }

                const dataUrl = await svgToDataUrl(svg.outerHTML, customSize.width, customSize.height);
                await chrome.downloads.download({
                    url: dataUrl,
                    filename: `svg_${svg.id}_${customSize.width}x${customSize.height}.png`,
                    saveAs: true
                });
            } else {
                // 下载预设尺寸
                const width = selectedSize.width || svg.dimensions.width;
                const height = selectedSize.height || svg.dimensions.height;

                const dataUrl = await svgToDataUrl(svg.outerHTML, width, height);
                await chrome.downloads.download({
                    url: dataUrl,
                    filename: `svg_${svg.id}_${width}x${height}.png`,
                    saveAs: true
                });
            }

            setDownloadStatus(prev => ({
                ...prev,
                [svg.id]: { loading: false }
            }));
        } catch (error) {
            console.error('下载错误:', error);
            setDownloadStatus(prev => ({
                ...prev,
                [svg.id]: { loading: false, error: error instanceof Error ? error.message : '未知错误' }
            }));
        }
    };

    const scanSVGs = async () => {
        setIsScanning(true);
        setScanError(null);

        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const activeTab = tabs[0];

            if (!activeTab?.id) {
                throw new Error('无法获取当前标签页');
            }

            setCurrentTabId(activeTab.id);

            const response = await chrome.tabs.sendMessage(activeTab.id, { action: "scanSVG" });
            if (response?.svgData) {
                setSvgItems(response.svgData);
            } else {
                setSvgItems([]);
            }
        } catch (error: unknown) {
            console.error('扫描错误:', error);
            setScanError(error instanceof Error ? error.message : '扫描失败');
            setSvgItems([]);
        } finally {
            setIsScanning(false);
        }
    };

    // 监听标签页变化
    useEffect(() => {
        const handleTabChange = async (activeInfo: { tabId: number }) => {
            if (currentTabId !== activeInfo.tabId) {
                await scanSVGs();
            }
        };

        const handleTabUpdate = async (
            tabId: number,
            changeInfo: { status?: string },
            tab: chrome.tabs.Tab
        ) => {
            if (changeInfo.status === 'complete' && tabId === currentTabId) {
                await scanSVGs();
            }
        };

        // 监听标签页激活事件
        chrome.tabs.onActivated.addListener(handleTabChange);
        // 监听标签页更新事件
        chrome.tabs.onUpdated.addListener(handleTabUpdate);

        // 初始扫描
        scanSVGs();

        return () => {
            chrome.tabs.onActivated.removeListener(handleTabChange);
            chrome.tabs.onUpdated.removeListener(handleTabUpdate);
        };
    }, [currentTabId]);

    // 使用 useCallback 包装 scanSVGs
    const debouncedScanSVGs = useCallback(
        debounce(() => {
            scanSVGs();
        }, 300),
        []
    );

    // 添加自动重试机制
    const retryOnError = async (fn: () => Promise<void>, maxRetries = 3) => {
        for (let i = 0; i < maxRetries; i++) {
            try {
                await fn();
                return;
            } catch (error) {
                if (i === maxRetries - 1) throw error;
                await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
            }
        }
    };

    useEffect(() => {
        retryOnError(scanSVGs);
    }, []);

    return (
        <div className="flex flex-col h-screen bg-gray-100 text-gray-800 w-[360px]">

            {/* 头部区域 */}
            <div className="sticky top-0 z-10 bg-white px-3 py-2 border-b border-gray-200 shadow-sm">
                <div className="flex justify-between items-center">
                    <h1 className="text-base font-medium">SVG to PNG Converter</h1>
                    <button
                        onClick={scanSVGs}
                        className="bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded text-sm transition-colors"
                        disabled={isScanning}
                    >
                        {isScanning ? '扫描中...' : '刷新'}
                    </button>
                </div>
            </div>

            {/* 主内容区域 */}
            <div className="flex-1 overflow-auto">
                {/* 加载状态 */}
                {isScanning && <LoadingSpinner />}

                {/* 错误提示 */}
                {scanError && (
                    <div className="m-3 bg-red-900/50 border border-red-700 text-red-200 px-3 py-2 rounded text-sm">
                        {scanError}
                    </div>
                )}

                {/* 空状态 */}
                {!isScanning && svgItems.length === 0 && !scanError && (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                        <svg className="w-12 h-12 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <p>当前页面未找到 SVG 元素</p>
                    </div>
                )}

                {/* SVG 列表 */}
                <div className="p-3 space-y-2">
                    {svgItems.map((svg) => (
                        <div key={svg.id} className="bg-white rounded-lg p-2 shadow-sm">
                            {/* 主要内容区域 */}
                            <div className="grid grid-cols-[40px_1fr_auto] gap-2 items-center">
                                {/* SVG 预览 */}
                                <div className="w-[32px] h-[32px] bg-gray-50 rounded flex items-center justify-center p-0.5">
                                    <div className="w-full h-full flex items-center justify-center bg-gray-100 rounded overflow-hidden"
                                        dangerouslySetInnerHTML={{ __html: svg.outerHTML }} />
                                </div>

                                {/* 尺寸选择 */}
                                <select
                                    value={selectedSizes[svg.id]?.label || '16x16'}
                                    onChange={(e) => {
                                        const size = PRESET_SIZES.find(s => s.label === e.target.value);
                                        if (size) {
                                            setSelectedSizes(prev => ({
                                                ...prev,
                                                [svg.id]: size
                                            }));
                                        }
                                    }}
                                    className="bg-gray-50 border-gray-200 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 w-full"
                                >
                                    {PRESET_SIZES.map((size) => (
                                        <option key={size.label} value={size.label}>
                                            {size.label}
                                        </option>
                                    ))}
                                </select>

                                {/* 下载按钮 */}
                                <button
                                    onClick={() => handleDownload(svg)}
                                    disabled={downloadStatus[svg.id]?.loading}
                                    className={`px-3 py-1 rounded text-sm font-medium transition-colors whitespace-nowrap ${downloadStatus[svg.id]?.loading
                                        ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                                        : 'bg-blue-500 hover:bg-blue-600 text-white'
                                        }`}
                                >
                                    {downloadStatus[svg.id]?.loading ? (
                                        <span className="flex items-center gap-1">
                                            <div className="w-3 h-3 border-2 border-gray-400 border-t-gray-600 rounded-full animate-spin" />
                                            下载中
                                        </span>
                                    ) : '下载 PNG'}
                                </button>
                            </div>

                            {/* 自定义尺寸输入区域 */}
                            {selectedSizes[svg.id]?.width === -2 && (
                                <div className="mt-2 pt-2 border-t border-gray-100">
                                    <CustomSizeInputs svg={svg} />
                                </div>
                            )}

                            {/* 错误提示 */}
                            {downloadStatus[svg.id]?.error && (
                                <div className="mt-2 text-red-500 text-xs">
                                    {downloadStatus[svg.id].error}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
} 