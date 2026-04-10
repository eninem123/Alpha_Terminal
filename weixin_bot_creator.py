#!/usr/bin/env python3
# Copyright (C) 2025 Tencent. All rights reserved.
#
# 本软件由腾讯轻量云团队自主研发，受中华人民共和国著作权法及国际版权公约保护。
# 未经腾讯书面授权，任何单位或个人不得以任何形式复制、修改、传播或用于商业用途。违者将承担相应的法律责任。
#
# This software is independently developed by Tencent Lighthouse Team.
# Unauthorized copying, modification, distribution, or commercial use
# of this software, in whole or in part, is strictly prohibited.
# Violators will be held liable under applicable laws.
#
# Author: Tencent Lighthouse Team
"""
微信 (WeChat) OpenClaw 频道 - 扫码登录 + 自动配置 (非交互式)

用法:
    python3 weixin_bot_creator.py create          # 完整流程: 获取二维码URL → 扫码 → 写入配置
    python3 weixin_bot_creator.py cleanup          # 清理账号数据

流程: create (获取QR URL → 用户扫码 → 写入凭证/配置 → 重启gateway)
stdout 输出协议: 每行一个 JSON 对象，包含 action/level/step/message/ts 等字段
"""

import json
import os
import re
import subprocess
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

# ── 强制 stdout write-through ──
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(write_through=True)
elif hasattr(sys.stdout, "buffer"):
    import io as _io
    sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, write_through=True)

# ============================================================
# 路径常量
# ============================================================
HOME = Path.home()
_env_state_dir = os.environ.get("OPENCLAW_STATE_DIR", "").strip()
STATE_DIR = Path(_env_state_dir) if _env_state_dir else (HOME / ".openclaw")
OPENCLAW_CONFIG = STATE_DIR / "openclaw.json"
WEIXIN_STATE_DIR = STATE_DIR / "openclaw-weixin"
ACCOUNTS_DIR = WEIXIN_STATE_DIR / "accounts"
ACCOUNTS_INDEX = WEIXIN_STATE_DIR / "accounts.json"
CREDENTIALS_DIR = STATE_DIR / "credentials"
PLUGIN_DIR = STATE_DIR / "extensions" / "openclaw-weixin"

# ============================================================
# 兜底默认值
# ============================================================
FALLBACK_BASE_URL = "https://ilinkai.weixin.qq.com"
FALLBACK_BOT_TYPE = "3"
FALLBACK_QR_ENDPOINT = "ilink/bot/get_bot_qrcode"
FALLBACK_STATUS_ENDPOINT = "ilink/bot/get_qrcode_status"

# ============================================================
# 结构化 JSON 日志协议 (与 feishu/whatsapp/yuanbao 一致)
# ============================================================

def _emit(action: str, level: str, step: str, message: str, **extra) -> None:
    record = {"action": action, "level": level, "step": step,
              "message": message, "ts": int(time.time())}
    record.update(extra)
    print(json.dumps(record, ensure_ascii=False))


def _log_info(step: str, message: str, **extra) -> None:
    _emit("log", "info", step, message, **extra)


def _log_success(step: str, message: str, **extra) -> None:
    _emit("log", "success", step, message, **extra)


def _log_warn(step: str, message: str, **extra) -> None:
    _emit("log", "warn", step, message, **extra)


def _log_error(step: str, message: str, **extra) -> None:
    _emit("log", "error", step, message, **extra)


def _emit_progress(step: str, message: str, current: int, total: int) -> None:
    _emit("progress", "info", step, message, current=current, total=total)


def _emit_finish(message: str, data: dict) -> None:
    _emit("finish", "success", "finish", message, data=data)


def _emit_error(step: str, message: str) -> None:
    _emit("finish", "error", step, message)


# ============================================================
# 工具函数
# ============================================================

def normalize_account_id(raw: str) -> str:
    """将原始账号ID中的 @ 和 . 替换为 -，与 Node.js SDK 的 normalizeAccountId 一致。"""
    return re.sub(r'[@.]', '-', raw)


def _safe_key(raw: str) -> str:
    trimmed = raw.strip().lower()
    if not trimmed:
        raise ValueError("invalid key for allowFrom path")
    safe = re.sub(r'[\\/:*?"<>|]', '_', trimmed).replace('..', '_')
    if not safe or safe == '_':
        raise ValueError("invalid key for allowFrom path")
    return safe


def _resolve_allow_from_path(account_id: str) -> Path:
    base = _safe_key("openclaw-weixin")
    safe_account = _safe_key(account_id)
    return CREDENTIALS_DIR / f"{base}-{safe_account}-allowFrom.json"


# ============================================================
# 插件版本检测
# ============================================================

def detect_plugin_version() -> str:
    """读取插件 package.json 获取版本号，失败返回 'unknown'。"""
    pkg_json = PLUGIN_DIR / "package.json"
    if not pkg_json.is_file():
        return "unknown"
    try:
        with open(pkg_json) as f:
            data = json.load(f)
        return data.get("version", "unknown")
    except (json.JSONDecodeError, IOError):
        return "unknown"


def parse_semver(ver: str):
    """解析 x.y.z 版本号，返回 (major, minor, patch) 或 None。"""
    m = re.match(r'^(\d+)\.(\d+)\.(\d+)', ver)
    if m:
        return (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return None


# ============================================================
# OpenClaw 版本检测与兼容性校验
# ============================================================

# 兼容性表（与微信插件 README 一致）：
#   插件 2.0.x  →  OpenClaw >= 2026.3.22
#   插件 1.0.x  →  OpenClaw >= 2026.1.0 且 < 2026.3.22
COMPAT_TABLE = [
    # (plugin_major, host_min_inclusive, host_max_exclusive_or_none)
    (2, (2026, 3, 22), None),            # 2.0.x 要求 >= 2026.3.22，无上限
    (1, (2026, 1, 0), (2026, 3, 22)),    # 1.0.x 要求 >= 2026.1.0 且 < 2026.3.22
]


def detect_openclaw_version() -> str:
    """通过 openclaw --version 获取版本，失败返回 'unknown'。
    命令输出格式示例: 'OpenClaw 2026.3.24 (cff6dc9)'，需要提取纯版本号。"""
    try:
        r = subprocess.run(["openclaw", "--version"], capture_output=True, text=True, timeout=10)
        output = r.stdout.strip()
        if output:
            # 从输出中提取 YYYY.M.DD 格式的版本号
            m = re.search(r'(\d{4}\.\d{1,2}\.\d{1,2})', output)
            if m:
                return m.group(1)
            return output  # 兜底返回原始输出
    except (subprocess.SubprocessError, FileNotFoundError):
        pass
    return "unknown"


def parse_openclaw_version(ver: str):
    """解析 OpenClaw 日期版本号 YYYY.M.DD（如 2026.3.22），返回 (year, month, day) 或 None。"""
    # 去掉预发布后缀，如 2026.3.22-beta.1
    base = ver.strip().split("-")[0]
    parts = base.split(".")
    if len(parts) != 3:
        return None
    try:
        return (int(parts[0]), int(parts[1]), int(parts[2]))
    except ValueError:
        return None


def check_version_compat(plugin_version: str, host_version: str) -> str | None:
    """
    检查插件版本与 OpenClaw 版本是否兼容。
    兼容返回 None，不兼容返回错误信息字符串。
    """
    plugin_sem = parse_semver(plugin_version)
    host_ver = parse_openclaw_version(host_version)

    if plugin_sem is None or host_ver is None:
        return None  # 无法解析时跳过检查，不阻断流程

    plugin_major = plugin_sem[0]

    for (major, host_min, host_max) in COMPAT_TABLE:
        if plugin_major == major:
            if host_ver < host_min:
                return (
                    f"微信插件 {plugin_version} 要求 OpenClaw >= "
                    f"{host_min[0]}.{host_min[1]}.{host_min[2]}，"
                    f"但当前版本为 {host_version}。\n"
                    f"请升级 OpenClaw，或安装兼容的插件版本：\n"
                    f"  openclaw plugins install @tencent-weixin/openclaw-weixin@legacy"
                )
            if host_max is not None and host_ver >= host_max:
                return (
                    f"微信插件 {plugin_version} (1.x legacy) 仅支持 OpenClaw "
                    f">= {host_min[0]}.{host_min[1]}.{host_min[2]} 且 "
                    f"< {host_max[0]}.{host_max[1]}.{host_max[2]}，"
                    f"但当前版本为 {host_version}。\n"
                    f"请安装最新版插件：\n"
                    f"  openclaw plugins install @tencent-weixin/openclaw-weixin@latest"
                )
            return None  # 兼容

    # 未知的 plugin major，跳过检查
    return None


# ============================================================
# 从插件源码动态提取 API 地址
# ============================================================

def _extract_from_plugin_source() -> dict:
    """从插件关键源文件中提取 base_url、bot_type、QR endpoint、status endpoint。"""
    result = {
        "base_url": None,
        "bot_type": None,
        "qr_endpoint": None,
        "status_endpoint": None,
    }

    # 只读取包含所需常量的 2 个文件，而非扫描全部 src
    target_files = [
        PLUGIN_DIR / "src" / "auth" / "accounts.ts",   # DEFAULT_BASE_URL
        PLUGIN_DIR / "src" / "auth" / "login-qr.ts",   # DEFAULT_ILINK_BOT_TYPE, endpoints
    ]
    parts = []
    for f in target_files:
        try:
            if f.is_file():
                parts.append(f.read_text(encoding="utf-8", errors="ignore"))
        except IOError:
            pass

    if not parts:
        return result

    all_text = "\n".join(parts)

    # 提取 base URL
    for pattern in [
        r'(?:DEFAULT_BASE_URL|FIXED_BASE_URL)\s*=\s*["\']([^"\']+)["\']',
        r'(?:baseUrl|apiBaseUrl)\s*(?:=|:)\s*["\']([^"\']+://[^"\']+)["\']',
    ]:
        m = re.search(pattern, all_text)
        if m:
            result["base_url"] = m.group(1).rstrip("/")
            break

    # 提取 bot_type
    m = re.search(r'DEFAULT_ILINK_BOT_TYPE\s*=\s*["\'](\d+)["\']', all_text)
    if m:
        result["bot_type"] = m.group(1)

    # 提取 QR endpoint
    m = re.search(r'([\w-]+(?:/[\w-]+)+/get_bot_qrcode)', all_text)
    if not m:
        m = re.search(r'(get_bot_qrcode)', all_text)
    if m:
        result["qr_endpoint"] = m.group(1)

    # 提取 status endpoint
    m = re.search(r'([\w-]+(?:/[\w-]+)+/get_qrcode_status)', all_text)
    if not m:
        m = re.search(r'(get_qrcode_status)', all_text)
    if m:
        result["status_endpoint"] = m.group(1)

    return result


def resolve_api_config() -> dict:
    """从插件源码提取 API 配置，找不到则使用兜底值。"""
    extracted = _extract_from_plugin_source()
    config = {
        "base_url": extracted["base_url"] or FALLBACK_BASE_URL,
        "bot_type": extracted["bot_type"] or FALLBACK_BOT_TYPE,
        "qr_endpoint": extracted["qr_endpoint"] or FALLBACK_QR_ENDPOINT,
        "status_endpoint": extracted["status_endpoint"] or FALLBACK_STATUS_ENDPOINT,
    }
    fallback_keys = [k for k in extracted if extracted[k] is None]
    if fallback_keys:
        _log_warn("init", f"未能从插件源码提取: {', '.join(fallback_keys)}，使用兜底值")
    return config


# ============================================================
# HTTP 请求工具
# ============================================================

def _http_get(url: str, timeout: int = 40, headers: dict = None) -> dict:
    """发送 GET 请求并返回 JSON 响应。"""
    req = urllib.request.Request(url)
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw)


# ============================================================
# QR 登录核心流程
# ============================================================

def fetch_qrcode(api_config: dict) -> dict:
    """获取二维码，返回 {"qrcode": "token", "qrcode_img_content": "url"}。"""
    base = api_config["base_url"].rstrip("/")
    ep = api_config["qr_endpoint"]
    bt = api_config["bot_type"]
    url = f"{base}/{ep}?bot_type={bt}"
    return _http_get(url, timeout=10)


def poll_qr_status(api_config: dict, qrcode: str, poll_base_url: str = None) -> dict:
    """轮询二维码扫码状态 (长轮询，35s超时)。"""
    base = (poll_base_url or api_config["base_url"]).rstrip("/")
    ep = api_config["status_endpoint"]
    url = f"{base}/{ep}?qrcode={urllib.request.quote(qrcode)}"
    headers = {"iLink-App-ClientVersion": "1"}
    try:
        return _http_get(url, timeout=40, headers=headers)
    except (urllib.error.URLError, TimeoutError, OSError):
        # 网络超时或连接错误，视为 wait 继续轮询
        return {"status": "wait"}
    except json.JSONDecodeError:
        # 响应格式异常，也继续轮询
        return {"status": "wait"}


def do_qr_login(api_config: dict, plugin_version: str) -> dict:
    """
    完整的 QR 登录流程。
    返回: {"ok": True, "bot_token", "account_id", "base_url", "user_id"} 或 {"ok": False, "error": "..."}
    """
    timeout_sec = 480
    MAX_QR_REFRESH = 3
    sem = parse_semver(plugin_version)
    support_redirect = sem is not None and sem >= (2, 1, 0)

    # 1. 获取二维码
    try:
        qr_resp = fetch_qrcode(api_config)
    except Exception as e:
        return {"ok": False, "error": f"获取二维码失败: {e}"}

    qrcode_token = qr_resp.get("qrcode", "")
    qrcode_url = qr_resp.get("qrcode_img_content", "")

    if not qrcode_token or not qrcode_url:
        return {"ok": False, "error": "服务端返回的二维码数据不完整"}

    # 2. 输出二维码 URL 给调用方
    _emit("show_qrcode", "info", "login", "请使用微信扫描二维码", content=qrcode_url)

    # 3. 轮询扫码状态
    deadline = time.time() + timeout_sec
    scanned_printed = False
    qr_refresh_count = 1
    poll_base_url = None  # IDC redirect 用

    while time.time() < deadline:
        status_resp = poll_qr_status(api_config, qrcode_token, poll_base_url)
        status = status_resp.get("status", "wait")

        if status == "wait":
            _emit_progress("login", "等待扫码...", current=int(time.time() - (deadline - timeout_sec)),
                           total=timeout_sec)

        elif status == "scaned":
            if not scanned_printed:
                _log_info("login", "已扫码，请在微信上确认")
                scanned_printed = True

        elif status == "scaned_but_redirect" and support_redirect:
            redirect_host = status_resp.get("redirect_host")
            if redirect_host:
                poll_base_url = f"https://{redirect_host}"
                _log_info("login", f"IDC 重定向，切换轮询地址: {poll_base_url}")
            if not scanned_printed:
                _log_info("login", "已扫码，请在微信上确认")
                scanned_printed = True

        elif status == "expired":
            qr_refresh_count += 1
            if qr_refresh_count > MAX_QR_REFRESH:
                return {"ok": False, "error": "二维码多次过期，请重新开始"}
            _log_warn("login", f"二维码已过期，正在刷新 ({qr_refresh_count}/{MAX_QR_REFRESH})")
            try:
                qr_resp = fetch_qrcode(api_config)
                qrcode_token = qr_resp.get("qrcode", "")
                qrcode_url = qr_resp.get("qrcode_img_content", "")
                scanned_printed = False
                poll_base_url = None
                _emit("show_qrcode", "info", "login", "新二维码已生成，请重新扫描", content=qrcode_url)
            except Exception as e:
                return {"ok": False, "error": f"刷新二维码失败: {e}"}

        elif status == "confirmed":
            bot_token = status_resp.get("bot_token", "")
            ilink_bot_id = status_resp.get("ilink_bot_id", "")
            base_url = status_resp.get("baseurl", "")
            user_id = status_resp.get("ilink_user_id", "")
            if not ilink_bot_id:
                return {"ok": False, "error": "登录成功但服务器未返回 ilink_bot_id"}
            _log_success("login", "微信扫码登录成功")
            return {
                "ok": True,
                "bot_token": bot_token,
                "account_id": ilink_bot_id,
                "base_url": base_url,
                "user_id": user_id,
            }

        time.sleep(1)

    return {"ok": False, "error": f"登录超时 ({timeout_sec}s)"}


# ============================================================
# 配置文件写入 (不依赖 openclaw CLI)
# ============================================================

def write_account_credentials(account_id: str, bot_token: str, base_url: str, user_id: str) -> bool:
    """写入账号凭证: ~/.openclaw/openclaw-weixin/accounts/{normalizedId}.json"""
    norm_id = normalize_account_id(account_id)
    ACCOUNTS_DIR.mkdir(parents=True, exist_ok=True)
    fpath = ACCOUNTS_DIR / f"{norm_id}.json"
    data = {
        "token": bot_token,
        "savedAt": datetime.now(timezone.utc).isoformat(),
        "baseUrl": base_url,
        "userId": user_id,
    }
    try:
        with open(fpath, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.chmod(fpath, 0o600)
        return True
    except IOError as e:
        _log_error("config", f"写入账号凭证失败: {e}")
        return False


def register_account_index(account_id: str) -> None:
    """注册账号ID到 accounts.json 索引。"""
    norm_id = normalize_account_id(account_id)
    WEIXIN_STATE_DIR.mkdir(parents=True, exist_ok=True)
    existing = []
    if ACCOUNTS_INDEX.is_file():
        try:
            existing = json.loads(ACCOUNTS_INDEX.read_text())
            if not isinstance(existing, list):
                existing = []
        except (json.JSONDecodeError, IOError):
            existing = []
    if norm_id not in existing:
        existing.append(norm_id)
        ACCOUNTS_INDEX.write_text(json.dumps(existing, indent=2))


def clear_stale_accounts(current_account_id: str, user_id: str) -> None:
    """清理同 userId 的旧账号（防重复登录）。"""
    if not user_id:
        return
    norm_current = normalize_account_id(current_account_id)
    if not ACCOUNTS_INDEX.is_file():
        return
    try:
        all_ids = json.loads(ACCOUNTS_INDEX.read_text())
    except (json.JSONDecodeError, IOError):
        return
    if not isinstance(all_ids, list):
        return
    for aid in list(all_ids):
        if aid == norm_current:
            continue
        fpath = ACCOUNTS_DIR / f"{aid}.json"
        try:
            if fpath.is_file():
                data = json.loads(fpath.read_text())
                if data.get("userId", "").strip() == user_id:
                    _log_info("clean", f"清理旧账号: {aid}")
                    fpath.unlink()
                    # 清理 allowFrom
                    af_path = _resolve_allow_from_path(aid)
                    if af_path.is_file():
                        af_path.unlink()
                    all_ids.remove(aid)
        except (json.JSONDecodeError, IOError):
            pass
    ACCOUNTS_INDEX.write_text(json.dumps(all_ids, indent=2))


def write_allow_from(account_id: str, user_id: str) -> bool:
    """写入 allowFrom: ~/.openclaw/credentials/openclaw-weixin-{accountId}-allowFrom.json"""
    norm_id = normalize_account_id(account_id)
    fpath = _resolve_allow_from_path(norm_id)
    CREDENTIALS_DIR.mkdir(parents=True, exist_ok=True)
    data = {"version": 1, "allowFrom": [user_id]}
    try:
        with open(fpath, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return True
    except IOError as e:
        _log_error("config", f"写入 allowFrom 失败: {e}")
        return False


def write_openclaw_channel_config() -> bool:
    """在 openclaw.json 中写入 channels 和 plugins 配置，确保 gateway 能加载微信通道。"""
    if not OPENCLAW_CONFIG.is_file():
        _log_error("config", f"配置文件不存在: {OPENCLAW_CONFIG}")
        return False
    try:
        config = json.loads(OPENCLAW_CONFIG.read_text())
    except (json.JSONDecodeError, IOError) as e:
        _log_error("config", f"读取配置文件失败: {e}")
        return False

    # 1. 确保 channels.openclaw-weixin.accounts 存在
    channels = config.setdefault("channels", {})
    weixin_ch = channels.get("openclaw-weixin", {})
    if "accounts" not in weixin_ch or not weixin_ch.get("accounts"):
        weixin_ch["accounts"] = {}
    channels["openclaw-weixin"] = weixin_ch
    config["channels"] = channels



    try:
        OPENCLAW_CONFIG.write_text(json.dumps(config, indent=2, ensure_ascii=False))
        return True
    except IOError as e:
        _log_error("config", f"写入 openclaw.json 失败: {e}")
        return False



# ============================================================
# 命令: create
# 完整流程: 检测插件 → 获取QR → 扫码 → 写入配置
# ============================================================

def cmd_create():
    # 1. 检测插件版本
    plugin_version = detect_plugin_version()
    if plugin_version == "unknown":
        _emit_error("init", "未找到微信插件，请先安装 openclaw-weixin")
        sys.exit(1)

    # 2. 检测 OpenClaw 版本，校验与插件的兼容性
    host_version = detect_openclaw_version()
    _log_info("init", f"OpenClaw 版本: {host_version}，微信插件版本: {plugin_version}")

    if host_version == "unknown":
        _log_warn("init", "无法检测 OpenClaw 版本，跳过兼容性检查")
    else:
        compat_error = check_version_compat(plugin_version, host_version)
        if compat_error:
            _emit_error("init", f"版本不兼容: {compat_error}")
            sys.exit(1)
        _log_info("init", "版本兼容性检查通过")

    # 3. 从插件源码提取 API 配置
    api_config = resolve_api_config()
    _log_info("init", f"插件 v{plugin_version}，API: {api_config['base_url']}")

    # 4. QR 登录
    login_result = do_qr_login(api_config, plugin_version)

    if not login_result["ok"]:
        _emit_error("login", login_result["error"])
        sys.exit(1)

    raw_account_id = login_result["account_id"]
    bot_token = login_result["bot_token"]
    base_url = login_result["base_url"]
    user_id = login_result["user_id"]
    norm_id = normalize_account_id(raw_account_id)

    # 5. 写入配置
    _emit("write_config", "info", "config", f"写入配置，账号: {norm_id}")
    if not write_account_credentials(raw_account_id, bot_token, base_url, user_id):
        _emit_error("config", "写入账号凭证失败")
        sys.exit(1)

    register_account_index(raw_account_id)
    clear_stale_accounts(raw_account_id, user_id)

    if user_id:
        write_allow_from(raw_account_id, user_id)

    write_openclaw_channel_config()
    _log_success("config", "配置写入完成")

    # 6. 完成
    result = {
        "account_id": norm_id,
        "user_id": user_id,
        "base_url": base_url,
        "plugin_version": plugin_version,
    }
    _emit_finish(f"微信频道配置完成", result)


# ============================================================
# 命令: cleanup
# ============================================================

def cmd_cleanup():
    """清理微信账号数据（凭证、索引、allowFrom）。"""
    _log_info("cleanup", "清理微信账号数据...")
    cleaned = 0

    if ACCOUNTS_DIR.is_dir():
        for f in ACCOUNTS_DIR.iterdir():
            if f.suffix == ".json":
                try:
                    f.unlink()
                    cleaned += 1
                except OSError:
                    pass

    if ACCOUNTS_INDEX.is_file():
        try:
            ACCOUNTS_INDEX.unlink()
            cleaned += 1
        except OSError:
            pass

    # 清理 allowFrom 文件
    if CREDENTIALS_DIR.is_dir():
        for f in CREDENTIALS_DIR.glob("openclaw-weixin-*-allowFrom.json"):
            try:
                f.unlink()
                cleaned += 1
            except OSError:
                pass

    _log_success("cleanup", f"已清理 {cleaned} 个文件")


# ============================================================
# 入口
# ============================================================

def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help", "help"):
        print(__doc__)
        sys.exit(0)

    cmd = sys.argv[1]

    if cmd == "create":
        cmd_create()
    elif cmd == "cleanup":
        cmd_cleanup()
    else:
        _emit_error("main", f"未知命令: {cmd}")
        sys.exit(1)


if __name__ == "__main__":
    main()
