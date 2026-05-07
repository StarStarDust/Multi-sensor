# eMotion Air Integration

[![Open your Home Assistant instance and open a repository in HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=StarStarDust&repository=Multi-sensor&category=Integration)

Home Assistant custom integration for the eMotion Air Zigbee multi-sensor. This integration provides automatic OTA firmware updates, Zigbee Quirks for advanced button features, and Automation Blueprints.

## Features

- **Automated OTA Updates:** Automatically downloads the latest firmware from GitHub Releases and places it in the ZHA OTA directory (`/config/zigpy_ota/`).
- **ZHA Quirks Installation:** Automatically deploys `emotionair_quirk.py` to `/config/custom_zha_quirks/` and auto-configures your `configuration.yaml` to ensure ZHA perfectly recognizes all multi-state button events (single, double, hold, etc.).
- **Automation Blueprints:** Installs pre-configured automation blueprints directly into `/config/blueprints/automation/emotionair/` for instant, out-of-the-box automation setups.

## Installation

### Via HACS (Recommended)

1. Open HACS in your Home Assistant
2. Click the three dots menu → **Custom repositories**
3. Add this repository URL, select **Integration** as the category
4. Click **Add** → Find "eMotion Air" → Click **Download**
5. **Restart Home Assistant** (Required for the Quirk and Blueprint files to be deployed and loaded)

### Manual Installation

1. Copy the `custom_components/emotionair` folder to your `/config/custom_components/` directory
2. Restart Home Assistant

## Configuration

1. Go to **Settings** → **Devices & Services** → **Add Integration**
2. Search for **eMotion Air**
3. Follow the setup wizard

## How It Works

1. Upon starting, the integration automatically injects the `zha` custom OTA and Quirk paths into your `configuration.yaml` if they don't already exist.
2. It copies the bundled `.py` Quirks and `.yaml` Blueprints to their respective HA directories.
3. It periodically checks the repository's `zigbee_firmware/version.json` file (every 6 hours) for updates.
4. It automatically downloads the specific firmware file defined in the JSON to `/config/zigpy_ota/` when the version number increases.
5. Your eMotion Air device will receive the update automatically during its next OTA query, and its advanced button features will be parsed by the injected Quirk.

## Device Info

- **Manufacturer:** `LinknLink`
- **Product:** `eMotion Air`
- **Firmware Image Type:** `0x0301`
- **Manufacturer Code:** `0x4231`
