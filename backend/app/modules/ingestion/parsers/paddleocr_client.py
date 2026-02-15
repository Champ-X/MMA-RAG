"""
PaddleOCR-VL-1.5 API 客户端
封装 PDF 解析 API 调用逻辑
"""

import base64
import requests
from typing import Dict, Any, Optional
from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)


class PaddleOCRClient:
    """PaddleOCR-VL-1.5 API 客户端"""
    
    def __init__(self, api_url: Optional[str] = None, token: Optional[str] = None):
        """
        初始化客户端
        
        Args:
            api_url: API URL，如果为 None 则从配置读取
            token: API Token，如果为 None 则从配置读取
        """
        self.api_url = api_url or settings.paddleocr_api_url
        self.token = token or settings.paddleocr_token
        
        if not self.api_url or not self.token:
            raise ValueError(
                "PaddleOCR API URL 和 Token 必须配置。"
                "请设置环境变量 PADDLEOCR_API_URL 和 PADDLEOCR_TOKEN"
            )
    
    def parse_pdf(
        self,
        file_content: bytes,
        file_type: int = 0,
        use_doc_orientation_classify: bool = False,
        use_doc_unwarping: bool = False,
        use_chart_recognition: bool = False,
        timeout: int = 300,
        max_pixels: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        解析 PDF 文件
        
        Args:
            file_content: PDF 文件二进制内容
            file_type: 文件类型，0 表示 PDF，1 表示图片
            use_doc_orientation_classify: 是否使用图片方向矫正
            use_doc_unwarping: 是否使用图片扭曲矫正
            use_chart_recognition: 是否使用图表识别
            timeout: 请求超时时间（秒）
            max_pixels: VLM 预处理图像像素上限（仅当服务端支持时生效，越大越清晰）
            
        Returns:
            解析结果字典，包含 layoutParsingResults 等字段
            
        Raises:
            ValueError: 如果 API 调用失败
            requests.RequestException: 如果网络请求失败
        """
        try:
            # 将文件编码为 Base64
            file_data = base64.b64encode(file_content).decode("ascii")
            
            # 设置请求头
            headers = {
                "Authorization": f"token {self.token}",
                "Content-Type": "application/json"
            }
            
            # 构建请求负载
            payload = {
                "file": file_data,
                "fileType": file_type,
                "useDocOrientationClassify": use_doc_orientation_classify,
                "useDocUnwarping": use_doc_unwarping,
                "useChartRecognition": use_chart_recognition,
            }
            if max_pixels is not None and max_pixels > 0:
                payload["maxPixels"] = max_pixels
            
            if not self.api_url:
                raise ValueError("PaddleOCR API URL 未配置")
            logger.info(f"正在调用 PaddleOCR API: {self.api_url}")
            logger.debug(f"文件大小: {len(file_content) / 1024:.2f} KB")
            
            # 发送请求
            response = requests.post(
                self.api_url,
                json=payload,
                headers=headers,
                timeout=timeout
            )
            
            if response.status_code != 200:
                error_msg = f"PaddleOCR API 返回错误状态码: {response.status_code}, 响应: {response.text}"
                logger.error(error_msg)
                raise ValueError(error_msg)
            
            result = response.json()
            
            # 检查 API 错误
            if "errorCode" in result and result["errorCode"] != 0:
                error_msg = result.get("errorMsg", "Unknown error")
                logger.error(f"PaddleOCR API 错误: {error_msg}")
                raise ValueError(f"PaddleOCR API 错误: {error_msg}")
            
            result_data = result.get("result", {})
            layout_results = result_data.get("layoutParsingResults", [])
            logger.info(f"PaddleOCR 解析成功: {len(layout_results)} 页")
            
            return result_data
            
        except requests.exceptions.Timeout:
            error_msg = f"PaddleOCR API 请求超时（{timeout}秒）"
            logger.error(error_msg)
            raise ValueError(error_msg)
        except requests.exceptions.RequestException as e:
            error_msg = f"PaddleOCR API 请求失败: {str(e)}"
            logger.error(error_msg)
            raise ValueError(error_msg)
        except Exception as e:
            error_msg = f"PaddleOCR API 调用异常: {str(e)}"
            logger.error(error_msg, exc_info=True)
            raise ValueError(error_msg)
    
    def download_image(self, image_url: str, timeout: int = 30) -> bytes:
        """
        从 URL 下载图片
        
        Args:
            image_url: 图片 URL
            timeout: 请求超时时间（秒）
            
        Returns:
            图片二进制数据
            
        Raises:
            ValueError: 如果下载失败
        """
        try:
            response = requests.get(image_url, timeout=timeout)
            if response.status_code == 200:
                return response.content
            else:
                error_msg = f"下载图片失败，状态码: {response.status_code}, URL: {image_url}"
                logger.error(error_msg)
                raise ValueError(error_msg)
        except requests.exceptions.RequestException as e:
            error_msg = f"下载图片时出错: {str(e)}, URL: {image_url}"
            logger.error(error_msg)
            raise ValueError(error_msg)


# 全局客户端实例（懒加载）
_client_instance: Optional[PaddleOCRClient] = None


def get_paddleocr_client() -> Optional[PaddleOCRClient]:
    """
    获取 PaddleOCR 客户端实例（懒加载）
    
    Returns:
        PaddleOCRClient 实例，如果配置不完整则返回 None
    """
    global _client_instance
    
    if _client_instance is None:
        try:
            _client_instance = PaddleOCRClient()
        except ValueError as e:
            logger.warning(f"PaddleOCR 客户端初始化失败: {e}")
            return None
    
    return _client_instance
