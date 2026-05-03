"""EmotionAir OTA Firmware Updater for Home Assistant."""
from __future__ import annotations

import logging
import os
import asyncio
from datetime import timedelta

import yaml
import aiohttp
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.event import async_track_time_interval

_LOGGER = logging.getLogger(__name__)

DOMAIN = "emotionair"

# ============================================================
#  配置项 - 根据你的实际情况修改
# ============================================================

# GitHub 仓库信息（固件存放在 GitHub Releases 的附件中）
GITHUB_REPO = "StarStarDust/Multi-sensor"

# GitHub API 地址，获取最新 Release
GITHUB_API_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"

# 固件文件的匹配规则（Release 附件中以 .zigbee 结尾的文件）
FIRMWARE_EXTENSION = ".zigbee"

# ZHA OTA 固件存放目录
OTA_DIR = "/config/zigpy_ota"

# HA 配置文件路径
CONFIGURATION_YAML = "/config/configuration.yaml"

# 默认检查间隔（小时）
DEFAULT_CHECK_INTERVAL = 6

# ============================================================


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up EmotionAir OTA from a config entry."""
    hass.data.setdefault(DOMAIN, {})

    # 确保 OTA 目录存在
    await hass.async_add_executor_job(_ensure_ota_dir)

    # 自动配置 ZHA 的 OTA 目录（修改 configuration.yaml）
    await hass.async_add_executor_job(_ensure_zha_ota_config)

    # 定义固件检查和下载函数
    async def check_and_download_firmware(_=None):
        """Check GitHub Releases for new firmware and download if available."""
        _LOGGER.info("EmotionAir OTA: 开始检查固件更新...")

        try:
            async with aiohttp.ClientSession() as session:
                # 1. 获取最新 Release 信息
                headers = {"Accept": "application/vnd.github.v3+json"}
                async with session.get(GITHUB_API_URL, headers=headers) as resp:
                    if resp.status != 200:
                        _LOGGER.error(
                            "EmotionAir OTA: 无法获取 GitHub Release 信息, "
                            "HTTP %s", resp.status
                        )
                        return
                    release_data = await resp.json()

                release_tag = release_data.get("tag_name", "unknown")
                assets = release_data.get("assets", [])

                # 2. 查找固件文件（.zigbee 结尾的附件）
                firmware_assets = [
                    a for a in assets
                    if a["name"].endswith(FIRMWARE_EXTENSION)
                ]

                if not firmware_assets:
                    _LOGGER.info(
                        "EmotionAir OTA: Release %s 中未找到固件文件",
                        release_tag
                    )
                    return

                # 3. 逐个检查并下载
                for asset in firmware_assets:
                    filename = asset["name"]
                    download_url = asset["browser_download_url"]
                    local_path = os.path.join(OTA_DIR, filename)

                    # 如果本地已存在同名文件，跳过
                    if await hass.async_add_executor_job(
                        os.path.exists, local_path
                    ):
                        _LOGGER.debug(
                            "EmotionAir OTA: 固件 %s 已存在，跳过下载",
                            filename
                        )
                        continue

                    # 下载固件
                    _LOGGER.info(
                        "EmotionAir OTA: 发现新固件 %s (%s)，开始下载...",
                        filename, release_tag
                    )

                    async with session.get(download_url) as fw_resp:
                        if fw_resp.status != 200:
                            _LOGGER.error(
                                "EmotionAir OTA: 固件下载失败, HTTP %s",
                                fw_resp.status
                            )
                            continue

                        fw_data = await fw_resp.read()

                    # 写入文件
                    await hass.async_add_executor_job(
                        _write_firmware, local_path, fw_data
                    )

                    _LOGGER.info(
                        "EmotionAir OTA: 固件 %s 下载完成 (%d bytes)，"
                        "已放入 %s",
                        filename, len(fw_data), OTA_DIR
                    )

        except aiohttp.ClientError as err:
            _LOGGER.error("EmotionAir OTA: 网络错误 - %s", err)
        except Exception as err:
            _LOGGER.error("EmotionAir OTA: 检查固件时出错 - %s", err)

    # 启动时立即检查一次
    hass.async_create_task(check_and_download_firmware())

    # 设置定时检查
    check_interval = entry.options.get(
        "check_interval_hours", DEFAULT_CHECK_INTERVAL
    )
    cancel_interval = async_track_time_interval(
        hass,
        check_and_download_firmware,
        timedelta(hours=check_interval),
    )

    # 保存清理函数，卸载时调用
    hass.data[DOMAIN][entry.entry_id] = {
        "cancel_interval": cancel_interval,
    }

    _LOGGER.info("EmotionAir OTA: 集成已启动，每 %d 小时检查一次固件更新", check_interval)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload EmotionAir OTA config entry."""
    data = hass.data[DOMAIN].pop(entry.entry_id, {})
    cancel = data.get("cancel_interval")
    if cancel:
        cancel()

    _LOGGER.info("EmotionAir OTA: 集成已卸载")
    return True


def _ensure_ota_dir():
    """Create the OTA directory if it doesn't exist."""
    os.makedirs(OTA_DIR, exist_ok=True)


def _write_firmware(path: str, data: bytes):
    """Write firmware data to file."""
    with open(path, "wb") as f:
        f.write(data)


def _ensure_zha_ota_config():
    """Ensure ZHA is configured to use the OTA directory.

    Uses the new `extra_providers` format with `type: advanced`.
    The `warning` field is required by zigpy and must match exactly.
    The user needs to restart HA once for ZHA to pick up the change.
    """
    # zigpy 要求的固定警告字符串，必须一字不差
    REQUIRED_WARNING = (
        "I understand I can *destroy* my devices by enabling OTA updates"
        " from files. Some OTA updates can be mistakenly applied to the"
        " wrong device, breaking it. I am consciously using this at my"
        " own risk."
    )

    try:
        # 读取现有配置
        config = {}
        if os.path.exists(CONFIGURATION_YAML):
            with open(CONFIGURATION_YAML, "r", encoding="utf-8") as f:
                config = yaml.safe_load(f) or {}

        # 检查是否已经配置了 advanced provider 指向我们的 OTA 目录
        zha_config = config.get("zha", {})
        zigpy_config = zha_config.get("zigpy_config", {})
        ota_config = zigpy_config.get("ota", {})
        extra_providers = ota_config.get("extra_providers", [])

        # 检查是否已存在指向 OTA_DIR 的 advanced provider
        for provider in extra_providers:
            if (
                provider.get("type") == "advanced"
                and provider.get("path") == OTA_DIR
            ):
                _LOGGER.debug(
                    "EmotionAir OTA: ZHA OTA advanced provider 已配置，无需修改"
                )
                return

        # 构建新的 advanced provider 配置
        new_provider = {
            "type": "advanced",
            "path": OTA_DIR,
            "warning": REQUIRED_WARNING,
        }

        # 确保配置路径存在
        if "zha" not in config:
            config["zha"] = {}
        if "zigpy_config" not in config["zha"]:
            config["zha"]["zigpy_config"] = {}
        if "ota" not in config["zha"]["zigpy_config"]:
            config["zha"]["zigpy_config"]["ota"] = {}
        if "extra_providers" not in config["zha"]["zigpy_config"]["ota"]:
            config["zha"]["zigpy_config"]["ota"]["extra_providers"] = []

        config["zha"]["zigpy_config"]["ota"]["extra_providers"].append(
            new_provider
        )

        # 写回配置文件
        with open(CONFIGURATION_YAML, "w", encoding="utf-8") as f:
            yaml.dump(config, f, default_flow_style=False, allow_unicode=True)

        _LOGGER.warning(
            "EmotionAir OTA: 已自动配置 ZHA OTA provider (path=%s)。"
            "请重启 Home Assistant 以使 ZHA 加载固件目录。",
            OTA_DIR,
        )

    except Exception as err:
        _LOGGER.error(
            "EmotionAir OTA: 自动配置 configuration.yaml 失败 - %s。"
            "请手动添加以下配置:\n"
            "zha:\n"
            "  zigpy_config:\n"
            "    ota:\n"
            "      extra_providers:\n"
            "        - type: advanced\n"
            "          path: /config/zigpy_ota\n"
            "          warning: 'I understand I can *destroy* my devices...'\n",
            err,
        )

