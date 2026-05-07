"""eMotion Air Firmware Updater for Home Assistant."""
from __future__ import annotations

import logging
import os
import shutil
import asyncio
from datetime import timedelta


import aiohttp
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.aiohttp_client import async_get_clientsession

_LOGGER = logging.getLogger(__name__)

DOMAIN = "emotionair"

# ============================================================
#  Configuration - Modify according to your needs
# ============================================================

# GitHub repo info (firmware is stored in GitHub Releases assets)
GITHUB_REPO = "StarStarDust/Multi-sensor"

# GitHub API URL to fetch latest Release
GITHUB_API_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"

# Firmware matching rule (files ending in .zigbee in Release assets)
FIRMWARE_EXTENSION = ".zigbee"

# ZHA OTA firmware storage directory
OTA_DIR = "/config/zigpy_ota"

# HA configuration file path
CONFIGURATION_YAML = "/config/configuration.yaml"

# HA Blueprint target directory
BLUEPRINT_DIR = "/config/blueprints/automation/emotionair"

# ZHA Quirks target directory
QUIRKS_DIR = "/config/custom_zha_quirks"

# Default check interval (hours)
DEFAULT_CHECK_INTERVAL = 6

# ============================================================


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up eMotion Air from a config entry."""
    hass.data.setdefault(DOMAIN, {})

    # Ensure OTA directory exists
    await hass.async_add_executor_job(_ensure_ota_dir)

    # Auto-configure ZHA OTA directory (modify configuration.yaml)
    await hass.async_add_executor_job(_ensure_zha_ota_config)

    # Auto-install blueprints
    await hass.async_add_executor_job(_install_blueprints)

    # Auto-install Quirks
    await hass.async_add_executor_job(_install_quirks)

    # Define firmware check and download function
    async def check_and_download_firmware(_=None):
        """Check GitHub Releases for new firmware and download if available."""
        _LOGGER.info("eMotion Air: Starting firmware update check...")

        try:
            session = async_get_clientsession(hass)
            # 1. Get latest Release info
            headers = {"Accept": "application/vnd.github.v3+json"}
            async with session.get(GITHUB_API_URL, headers=headers) as resp:
                if resp.status != 200:
                    _LOGGER.error(
                        "eMotion Air: Failed to fetch GitHub Release info, "
                        "HTTP %s", resp.status
                    )
                    return
                release_data = await resp.json()

            release_tag = release_data.get("tag_name", "unknown")
            assets = release_data.get("assets", [])

            # 2. Find firmware files (assets ending in .zigbee)
            firmware_assets = [
                a for a in assets
                if a["name"].endswith(FIRMWARE_EXTENSION)
            ]

            if not firmware_assets:
                _LOGGER.info(
                    "eMotion Air: No firmware file found in Release %s",
                    release_tag
                )
                return

            # 3. Check and download individually
            for asset in firmware_assets:
                filename = asset["name"]
                download_url = asset["browser_download_url"]
                local_path = os.path.join(OTA_DIR, filename)

                # Skip if local file already exists
                if await hass.async_add_executor_job(
                    os.path.exists, local_path
                ):
                    _LOGGER.debug(
                        "eMotion Air: Firmware %s already exists, skipping download",
                        filename
                    )
                    continue

                # Download firmware
                _LOGGER.info(
                    "eMotion Air: Found new firmware %s (%s), starting download...",
                    filename, release_tag
                )

                async with session.get(download_url) as fw_resp:
                    if fw_resp.status != 200:
                        _LOGGER.error(
                            "eMotion Air: Firmware download failed, HTTP %s",
                            fw_resp.status
                        )
                        continue

                    fw_data = await fw_resp.read()

                # Write to file
                await hass.async_add_executor_job(
                    _write_firmware, local_path, fw_data
                )

                _LOGGER.info(
                    "eMotion Air: Firmware %s downloaded successfully (%d bytes). "
                    "ZHA will pick this up automatically. No plugin update needed.",
                    filename, len(fw_data)
                )

        except aiohttp.ClientError as err:
            _LOGGER.error("eMotion Air: Network error - %s", err)
        except Exception as err:
            _LOGGER.error("eMotion Air: Error checking for firmware - %s", err)

    # Check immediately on startup
    hass.async_create_task(check_and_download_firmware())

    # Set up periodic check
    check_interval = entry.options.get(
        "check_interval_hours", DEFAULT_CHECK_INTERVAL
    )
    cancel_interval = async_track_time_interval(
        hass,
        check_and_download_firmware,
        timedelta(hours=check_interval),
    )

    # Save cleanup function, called on unload
    hass.data[DOMAIN][entry.entry_id] = {
        "cancel_interval": cancel_interval,
    }

    _LOGGER.info("eMotion Air: Integration started, checking for firmware updates every %d hours", check_interval)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload eMotion Air config entry."""
    data = hass.data[DOMAIN].pop(entry.entry_id, {})
    cancel = data.get("cancel_interval")
    if cancel:
        cancel()

    _LOGGER.info("eMotion Air: Integration unloaded")
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

    Appends the ZHA OTA provider config to configuration.yaml as plain text,
    avoiding yaml.safe_load() which cannot handle HA's !include tags.
    The user needs to restart HA once for ZHA to pick up the change.
    """
    REQUIRED_WARNING = (
        "I understand I can *destroy* my devices by enabling OTA updates"
        " from files. Some OTA updates can be mistakenly applied to the"
        " wrong device, breaking it. I am consciously using this at my"
        " own risk."
    )

    ZHA_CONFIG_BLOCK = f"""
# === eMotion Air & Quirks - Auto Generated ===
zha:
  custom_quirks_path: {QUIRKS_DIR}
  zigpy_config:
    ota:
      extra_providers:
        - type: advanced
          path: {OTA_DIR}
          warning: >-
            {REQUIRED_WARNING}
# === End eMotionAir Auto Config ===
"""

    try:
        # Read existing content
        content = ""
        if os.path.exists(CONFIGURATION_YAML):
            with open(CONFIGURATION_YAML, "r", encoding="utf-8") as f:
                content = f.read()

        # Skip if our new config is already present and path matches
        if "eMotion Air & Quirks - Auto Generated" in content and OTA_DIR in content:
            _LOGGER.debug(
                "eMotion Air: ZHA OTA provider config already exists and path matches, no modification needed"
            )
            return

        # If zha config exists, try to intelligently inject custom_quirks_path if missing
        if "zha:" in content:
            if "custom_quirks_path:" not in content:
                import re
                new_content = re.sub(
                    r'(^zha:[ \t]*(?:\n|\r\n))',
                    f'\\1  custom_quirks_path: {QUIRKS_DIR}\n',
                    content,
                    flags=re.MULTILINE
                )
                if new_content != content:
                    with open(CONFIGURATION_YAML, "w", encoding="utf-8") as f:
                        f.write(new_content)
                    _LOGGER.warning("eMotion Air: Automatically injected custom_quirks_path into your existing zha config.")
            else:
                _LOGGER.debug("eMotion Air: custom_quirks_path already exists in configuration.")
                
            _LOGGER.warning(
                "eMotion Air: Existing zha config detected in configuration.yaml, "
                "skipping full block auto-configuration. Ensure your OTA settings are correct."
            )
            return

        # Append to end of file
        with open(CONFIGURATION_YAML, "a", encoding="utf-8") as f:
            f.write(ZHA_CONFIG_BLOCK)

        _LOGGER.warning(
            "eMotion Air: Automatically added ZHA OTA provider config to configuration.yaml. "
            "Please restart Home Assistant to apply changes (%s).",
            OTA_DIR,
        )

    except Exception as err:
        _LOGGER.error(
            "eMotion Air: Failed to auto-configure configuration.yaml - %s. "
            "Please manually append the following:\n%s",
            err,
            ZHA_CONFIG_BLOCK,
        )


def _install_blueprints():
    """Copy bundled blueprint files to HA's blueprints directory."""
    try:
        # Bundled blueprints directory
        src_dir = os.path.join(os.path.dirname(__file__), "blueprints")

        if not os.path.exists(src_dir):
            _LOGGER.debug("eMotion Air: Bundled blueprints directory not found, skipping")
            return

        # Create target directory
        os.makedirs(BLUEPRINT_DIR, exist_ok=True)

        # Copy all .yaml blueprint files
        for filename in os.listdir(src_dir):
            if not filename.endswith(".yaml"):
                continue

            src_path = os.path.join(src_dir, filename)
            dst_path = os.path.join(BLUEPRINT_DIR, filename)

            # Always overwrite (ensure blueprint updates)
            shutil.copy2(src_path, dst_path)
            _LOGGER.info(
                "eMotion Air: Blueprint %s installed to %s",
                filename, BLUEPRINT_DIR,
            )

    except Exception as err:
        _LOGGER.error("eMotion Air: Failed to install blueprint - %s", err)


def _install_quirks():
    """Copy bundled quirk files to HA's custom_zha_quirks directory."""
    try:
        # Bundled quirks directory
        src_dir = os.path.join(os.path.dirname(__file__), "quirks")

        if not os.path.exists(src_dir):
            _LOGGER.debug("eMotion Air: Bundled quirks directory not found, skipping")
            return

        # Create target directory
        os.makedirs(QUIRKS_DIR, exist_ok=True)

        # Copy all .py files
        for filename in os.listdir(src_dir):
            if not filename.endswith(".py"):
                continue

            src_path = os.path.join(src_dir, filename)
            dst_path = os.path.join(QUIRKS_DIR, filename)

            # Always overwrite (ensure updates)
            shutil.copy2(src_path, dst_path)
            _LOGGER.info(
                "eMotion Air: Quirk %s installed to %s",
                filename, QUIRKS_DIR,
            )

    except Exception as err:
        _LOGGER.error("eMotion Air: Failed to install Quirk - %s", err)
