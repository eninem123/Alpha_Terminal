#!/usr/bin/env python3
# Copyright (C) 2025 Tencent. All rights reserved.
"""
OpenClaw OAuth 非交互式工具

用法:
    python3 oauth.py init  <qwen|minimax|codex> [region]
    python3 oauth.py poll  <qwen|minimax|codex> [code]

输出:
    {"action":"log","level":"info","step":"...","message":"...","ts":...}
    {"action":"finish","level":"success","step":"finish","message":"...","ts":...,"data":{...}}

exit code: 0=成功, 1=错误, 2=等待授权
"""

import base64
import hashlib
import json
import os
import re
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional

# ============================================================
# 强制 stdout 行缓冲 (管道环境下 Python 默认全缓冲)
# ============================================================
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(write_through=True)

VERSION = "1.0.0"
STATE_DIR = "/tmp"

# ============================================================
# Provider 配置
# ============================================================
PROVIDERS: Dict[str, Dict[str, Any]] = {
    "qwen": {
        "provider_id": "qwen-portal",
        "profile_id": "qwen-portal:default",
        "plugin_id": "qwen-portal-auth",
        "default_model": "qwen-portal/coder-model",
        "client_id": "f0304373b74a44d2b584a3fb70ca9e56",
    },
    "minimax": {
        "provider_id": "minimax-portal",
        "profile_id": "minimax-portal:default",
        "plugin_id": "minimax-portal-auth",
        "default_model": "minimax-portal/MiniMax-M2.5",
        "client_id": "78257093-7e40-4613-99e0-527b14b39113",
    },
    "codex": {
        "provider_id": "openai-codex",
        "profile_id": "openai-codex:default",
        "plugin_id": "",
        "default_model": "openai-codex/gpt-5.3-codex",
        "client_id": "app_EMoamEEZ73f0CkXaXp7hrann",
    },
}


# ============================================================
# 结构化 JSON 输出 (参考飞书 v3)
# ============================================================
def _emit(action: str, level: str, step: str, message: str, **extra) -> None:
    record = {"action": action, "level": level, "step": step,
              "message": message, "ts": int(time.time())}
    record.update(extra)
    print(json.dumps(record, ensure_ascii=False))


def _log_info(step: str, message: str, **kw) -> None:
    _emit("log", "info", step, message, **kw)


def _log_success(step: str, message: str, **kw) -> None:
    _emit("log", "success", step, message, **kw)


def _log_warn(step: str, message: str, **kw) -> None:
    _emit("log", "warn", step, message, **kw)


def _log_error(step: str, message: str, **kw) -> None:
    _emit("log", "error", step, message, **kw)


def _emit_finish(message: str, data: dict) -> None:
    _emit("finish", "success", "finish", message, data=data)


def _emit_error(step: str, message: str) -> None:
    _emit("finish", "error", step, message)


# ============================================================
# PKCE 工具
# ============================================================
def _gen_pkce() -> tuple:
    """生成 PKCE verifier + challenge (S256)"""
    verifier_bytes = secrets.token_bytes(32)
    verifier = base64.urlsafe_b64encode(verifier_bytes).rstrip(b"=").decode()
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return verifier, challenge


def _gen_state() -> str:
    return secrets.token_hex(16)


def _state_file(provider: str) -> str:
    return os.path.join(STATE_DIR, f"openclaw-oauth-{provider}.json")


def _token_file(provider: str) -> str:
    return _state_file(provider) + ".token"


# ============================================================
# HTTP 工具
# ============================================================
_DEFAULT_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"


def _build_headers(extra: dict | None = None) -> dict:
    h = {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": _DEFAULT_UA,
    }
    if extra:
        h.update(extra)
    return h


def _post_form(url: str, data: dict, timeout: int = 30) -> dict:
    """发送 application/x-www-form-urlencoded POST，返回 JSON。"""
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, headers=_build_headers())
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status = resp.status
            raw = resp.read()
    except urllib.error.HTTPError as e:
        raw = e.read()
        status = e.code
        if not raw or not raw.strip():
            raise RuntimeError(
                f"HTTP {status} 且响应体为空: {url}"
            ) from e
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            raise RuntimeError(
                f"HTTP {status} 响应非 JSON: {raw[:500]!r}"
            ) from e
    if not raw or not raw.strip():
        raise RuntimeError(
            f"HTTP {status} 服务器返回空响应体: {url}"
        )
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError(
            f"HTTP {status} 响应非 JSON (长度 {len(raw)}): {raw[:500]!r}"
        )


def _post_form_no_raise(url: str, data: dict, timeout: int = 30) -> dict:
    """同 _post_form，但 HTTP 错误也尝试解析 JSON body。"""
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, headers=_build_headers())
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read())
        except Exception:
            raise


# ============================================================
# 状态文件读写
# ============================================================
def _save_state(provider: str, data: dict) -> None:
    with open(_state_file(provider), "w") as f:
        json.dump(data, f, ensure_ascii=False)


def _load_state(provider: str) -> dict:
    sf = _state_file(provider)
    if not os.path.isfile(sf):
        _emit_error("poll", "状态文件不存在，请先运行 init")
        sys.exit(1)
    with open(sf) as f:
        return json.load(f)


def _save_token(provider: str, access: str, refresh: str, expires: int) -> None:
    data = {"status": "success", "access": access,
            "refresh": refresh, "expires": expires}
    with open(_token_file(provider), "w") as f:
        json.dump(data, f, ensure_ascii=False)


def _load_token(provider: str) -> dict:
    tf = _token_file(provider)
    if not os.path.isfile(tf):
        _log_error("apply", f"token 文件不存在 ({tf})")
        return {}
    with open(tf) as f:
        return json.load(f)


# ============================================================
# JSON 文件安全写入
# ============================================================
def _json_read(path: str, default: Any = None) -> Any:
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _json_write(path: str, data: Any) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


# ============================================================
# INIT
# ============================================================
def cmd_init(provider: str, region: str = "global") -> None:
    if provider not in PROVIDERS:
        _emit_error("init", f"未知 provider: {provider} (支持: {', '.join(PROVIDERS)})")
        sys.exit(1)

    verifier, challenge = _gen_pkce()

    if provider == "qwen":
        _log_info("init", "初始化 Qwen OAuth 授权")
        client_id = PROVIDERS["qwen"]["client_id"]

        resp = _post_form("https://chat.qwen.ai/api/v1/oauth2/device/code", {
            "client_id": client_id,
            "scope": "openid profile email model.completion",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        })

        device_code = resp["device_code"]
        user_code = resp["user_code"]
        verify_url = resp.get("verification_uri_complete") or resp["verification_uri"]
        expires_in = int(resp["expires_in"])
        deadline = int(time.time()) + expires_in

        _save_state(provider, {
            "provider": provider, "verifier": verifier,
            "device_code": device_code, "user_code": user_code,
            "url": verify_url, "deadline": deadline,
        })

        _log_success("init", "授权链接已生成")
        _emit("auth_url", "info", "init", "请访问链接完成授权",
              url=verify_url, user_code=user_code, deadline=deadline)

    elif provider == "minimax":
        if region not in ("cn", "intl"):
            _emit_error("init", f"minimax region 只支持 cn 或 intl，当前: {region}")
            sys.exit(1)
        base = "https://api.minimaxi.com" if region == "cn" else "https://api.minimax.io"
        _log_info("init", f"初始化 MiniMax OAuth 授权 (region: {region})")
        state = _gen_state()
        client_id = PROVIDERS["minimax"]["client_id"]

        resp = _post_form(f"{base}/oauth/code", {
            "response_type": "code",
            "client_id": client_id,
            "scope": "group_id profile model.completion",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "state": state,
        })

        if resp.get("state") != state:
            _emit_error("init", "state mismatch")
            sys.exit(1)

        user_code = resp["user_code"]
        verify_url = resp["verification_uri"]
        expired_in = int(resp["expired_in"])

        _save_state(provider, {
            "provider": provider, "verifier": verifier,
            "user_code": user_code, "url": verify_url,
            "base": base, "client_id": client_id,
            "expired_in": expired_in, "region": region,
        })

        _log_success("init", "授权链接已生成")
        _emit("auth_url", "info", "init", "请访问链接完成授权",
              url=verify_url, user_code=user_code,
              expired_in=expired_in, region=region)

    elif provider == "codex":
        _log_info("init", "初始化 Codex OAuth 授权")
        state = _gen_state()
        client_id = PROVIDERS["codex"]["client_id"]
        url = (
            "https://auth.openai.com/oauth/authorize?"
            + urllib.parse.urlencode({
                "response_type": "code",
                "client_id": client_id,
                "redirect_uri": "http://localhost:1455/auth/callback",
                "scope": "openid profile email offline_access",
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "state": state,
                "codex_cli_simplified_flow": "true",
            })
        )

        _save_state(provider, {
            "provider": provider, "verifier": verifier,
            "state": state, "url": url,
        })

        _log_success("init", "授权链接已生成")
        _emit("auth_url", "info", "init", "请访问链接完成授权", url=url)


# ============================================================
# APPLY (内部): 写入 openclaw 配置
# ============================================================
def _do_apply(provider: str) -> bool:
    token = _load_token(provider)
    if not token:
        return False

    access = token["access"]
    refresh = token["refresh"]
    expires = token["expires"]

    cfg = PROVIDERS[provider]
    profile_id = cfg["profile_id"]
    provider_id = cfg["provider_id"]
    plugin_id = cfg["plugin_id"]
    default_model = cfg["default_model"]

    home = Path.home()

    # 1. auth-profiles.json
    _log_info("apply", "写入 auth-profiles.json")
    ap_file = home / ".openclaw" / "agents" / "main" / "agent" / "auth-profiles.json"
    ap_file.parent.mkdir(parents=True, exist_ok=True)

    ap_data = _json_read(str(ap_file), {"version": 1, "profiles": {}})
    ap_data["version"] = 1
    ap_data.setdefault("profiles", {})[profile_id] = {
        "type": "oauth", "provider": provider_id,
        "access": access, "refresh": refresh, "expires": expires,
    }
    _json_write(str(ap_file), ap_data)
    _log_success("apply", "auth-profiles.json 已更新")

    # 2. openclaw.json
    _log_info("apply", "写入 openclaw.json")
    oc_file = home / ".openclaw" / "openclaw.json"
    if not oc_file.is_file():
        _log_error("apply", f"{oc_file} 不存在")
        return False

    oc_data = _json_read(str(oc_file))
    if oc_data is None:
        _log_error("apply", f"{oc_file} 解析失败")
        return False

    oc_data.setdefault("auth", {}).setdefault("profiles", {})[profile_id] = {
        "provider": provider_id, "mode": "oauth",
    }
    if plugin_id:
        oc_data.setdefault("plugins", {}).setdefault("entries", {})[plugin_id] = {
            "enabled": True,
        }
    _json_write(str(oc_file), oc_data)
    _log_success("apply", "openclaw.json 已更新")

    return True


# ============================================================
# POLL: 检查授权 / 交换 token → 成功后自动 apply
# ============================================================
def cmd_poll(provider: str, code_param: str = "") -> None:
    if provider not in PROVIDERS:
        _emit_error("poll", f"未知 provider: {provider}")
        sys.exit(1)

    state = _load_state(provider)

    if provider == "qwen":
        _log_info("poll", "轮询 Qwen 授权状态")
        deadline = state["deadline"]
        if int(time.time()) > deadline:
            _emit_error("poll", "device code 已过期，请重新 init")
            sys.exit(1)

        client_id = PROVIDERS["qwen"]["client_id"]
        resp = _post_form_no_raise("https://chat.qwen.ai/api/v1/oauth2/token", {
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            "client_id": client_id,
            "device_code": state["device_code"],
            "code_verifier": state["verifier"],
        })

        access = resp.get("access_token")
        if access:
            refresh = resp.get("refresh_token", "")
            expires_in = int(resp.get("expires_in", 86400))
            expires = int(time.time()) * 1000 + expires_in * 1000
            _save_token(provider, access, refresh, expires)
            _log_success("poll", "Token 获取成功")
        else:
            err = resp.get("error", "unknown")
            _emit("poll", "info", "poll", "用户尚未授权", error=err)
            sys.exit(2)

    elif provider == "minimax":
        _log_info("poll", "轮询 MiniMax 授权状态")
        expired_in = state["expired_in"]
        if int(time.time()) * 1000 > expired_in:
            _emit_error("poll", "user code 已过期，请重新 init")
            sys.exit(1)

        base = state["base"]
        client_id = state["client_id"]
        resp = _post_form_no_raise(f"{base}/oauth/token", {
            "grant_type": "urn:ietf:params:oauth:grant-type:user_code",
            "client_id": client_id,
            "user_code": state["user_code"],
            "code_verifier": state["verifier"],
        })

        status = resp.get("status")
        if status == "success":
            access = resp["access_token"]
            refresh = resp.get("refresh_token", "")
            expires = int(resp.get("expired_in", 0))
            _save_token(provider, access, refresh, expires)
            _log_success("poll", "Token 获取成功")
        elif status == "error":
            _emit_error("poll", resp.get("message", "未知错误"))
            sys.exit(1)
        else:
            _emit("poll", "info", "poll", "用户尚未授权")
            sys.exit(2)

    elif provider == "codex":
        _log_info("poll", "交换 Codex Token")
        if not code_param:
            _emit_error("poll", "用法: oauth.py poll codex <code参数或完整回调URL>")
            sys.exit(1)

        # 从 URL 中提取 code
        code = code_param
        m = re.search(r"code=([^&]+)", code_param)
        if m:
            code = m.group(1)

        client_id = PROVIDERS["codex"]["client_id"]
        resp = _post_form_no_raise("https://auth.openai.com/oauth/token", {
            "grant_type": "authorization_code",
            "client_id": client_id,
            "code": code,
            "code_verifier": state["verifier"],
            "redirect_uri": "http://localhost:1455/auth/callback",
        })

        access = resp.get("access_token")
        if access:
            refresh = resp.get("refresh_token", "")
            expires_in = int(resp.get("expires_in", 3600))
            expires = int(time.time()) * 1000 + expires_in * 1000
            _save_token(provider, access, refresh, expires)
            _log_success("poll", "Token 获取成功")
        else:
            err_msg = resp.get("error_description") or resp.get("error") or "token 交换失败"
            _emit_error("poll", err_msg)
            sys.exit(1)

    # ---- Token 获取成功，自动执行 apply ----
    _log_info("apply", "写入 OpenClaw 配置")
    if _do_apply(provider):
        _emit_finish("配置完成", {"provider": provider})
    else:
        _emit_error("apply", "配置写入失败")
        sys.exit(1)


# ============================================================
# 入口
# ============================================================
def main() -> None:
    args = sys.argv[1:]

    if not args or args[0] in ("-h", "--help", "help"):
        print("用法:")
        print("  python3 oauth.py init  <qwen|minimax|codex> <region>")
        print("  python3 oauth.py poll  <qwen|minimax|codex> [code]")
        print("")
        print("provider: qwen, minimax, codex")
        print("region: cn, intl (必传)")
        print("exit code: 0=成功, 1=错误, 2=等待授权")
        return

    cmd = args[0]

    if cmd in ("-v", "--version", "version"):
        print(VERSION)
    elif cmd == "init":
        if len(args) < 2:
            _emit_error("init", "用法: oauth.py init <qwen|minimax|codex> [region]")
            sys.exit(1)
        provider = args[1]
        region = args[2] if len(args) > 2 else ""
        if provider == "minimax" and region not in ("cn", "intl"):
            _emit_error("init", "minimax 必须指定 region: oauth.py init minimax <cn|intl>")
            sys.exit(1)
        cmd_init(provider, region)
    elif cmd == "poll":
        if len(args) < 2:
            _emit_error("poll", "用法: oauth.py poll <qwen|minimax|codex> [code]")
            sys.exit(1)
        provider = args[1]
        code_param = args[2] if len(args) > 2 else ""
        cmd_poll(provider, code_param)
    else:
        _emit_error("main", f"未知命令: {cmd}")
        sys.exit(1)


if __name__ == "__main__":
    main()
