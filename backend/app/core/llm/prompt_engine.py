"""
提示词引擎
统一管理所有系统提示词模板
"""

from typing import Dict, List, Any, Optional
from jinja2 import Template, Environment
from app.core.logger import get_logger
from app.core.llm.prompt import TEMPLATES

logger = get_logger(__name__)

class PromptEngine:
    """提示词引擎"""
    
    def __init__(self):
        self.templates: Dict[str, str] = {}
        self._load_templates()
    
    def _load_templates(self):
        """加载提示词模板"""
        # 从 prompt.py 模块导入所有模板
        self.templates = TEMPLATES.copy()
    
    def render_template(
        self, 
        template_name: str, 
        **kwargs
    ) -> str:
        """渲染模板"""
        
        template_str = self.templates.get(template_name)
        if not template_str:
            raise ValueError(f"模板 {template_name} 不存在")
        
        try:
            # 使用简单的字符串替换方法，避免Jinja2解析用户输入中的大括号导致错误
            result = template_str
            
            # 先替换模板变量，使用简单的字符串替换
            for key, value in kwargs.items():
                placeholder = "{" + key + "}"
                if placeholder in result:
                    # 直接替换，不需要转义（因为我们不使用Jinja2渲染用户输入）
                    result = result.replace(placeholder, str(value))
            
            return result
            
        except Exception as e:
            logger.error(f"模板渲染失败 {template_name}: {str(e)}", exc_info=True)
            # 如果模板渲染失败，尝试简单的字符串替换作为回退
            result = template_str
            for key, value in kwargs.items():
                placeholder = "{" + key + "}"
                if placeholder in result:
                    # 转义值中的大括号，防止再次触发格式化
                    safe_value = str(value).replace('{', '{{').replace('}', '}}')
                    result = result.replace(placeholder, safe_value)
            # 处理转义的JSON格式示例（移除 {% raw %} 和 {% endraw %}）
            result = result.replace("{% raw %}", "").replace("{% endraw %}", "")
            # 恢复模板变量（只恢复我们知道的变量）
            for key in kwargs.keys():
                result = result.replace(f'{{{{{key}}}}}', f'{{{key}}}')
            return result
    
    def get_template(self, template_name: str) -> str:
        """获取原始模板"""
        return self.templates.get(template_name, "")
    
    def add_template(self, name: str, template: str):
        """添加新模板"""
        self.templates[name] = template
        logger.info(f"添加新模板: {name}")
    
    def update_template(self, name: str, template: str):
        """更新模板"""
        if name in self.templates:
            self.templates[name] = template
            logger.info(f"更新模板: {name}")
        else:
            logger.warning(f"模板 {name} 不存在，将创建新模板")
            self.add_template(name, template)
    
    def list_templates(self) -> List[str]:
        """列出所有模板名称"""
        return list(self.templates.keys())
    
    def validate_template(self, name: str) -> Dict[str, Any]:
        """验证模板"""
        template_str = self.templates.get(name)
        if not template_str:
            return {"valid": False, "error": "模板不存在"}
        
        try:
            template = Template(template_str)
            # 尝试编译模板以验证语法
            template.render()
            return {"valid": True, "error": None}
        except Exception as e:
            return {"valid": False, "error": str(e)}

# 全局提示词引擎实例
prompt_engine = PromptEngine()
