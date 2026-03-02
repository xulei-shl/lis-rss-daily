"""Google Scholar 公共异常类"""


class ScholarError(Exception):
    """所有 scholar 相关错误的基类"""

    pass


class BrowserError(ScholarError):
    """浏览器相关错误"""

    pass


class AuthenticationError(ScholarError):
    """认证相关错误"""

    pass


class CaptchaError(ScholarError):
    """检测到验证码，无法继续检索

    需要人工处理或更换 IP 地址
    """

    pass


class RateLimitError(ScholarError):
    """达到每日查询限额或速率限制

    需要等待一段时间后重试
    """

    pass


class NoResultsError(ScholarError):
    """搜索没有返回结果"""

    pass


class TimeoutError(ScholarError):
    """操作超时"""

    pass


class NetworkError(ScholarError):
    """网络相关错误（代理、连接等）"""

    pass
