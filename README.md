# eMotion Air Firmware Updater

Home Assistant custom integration for automatic OTA firmware updates of eMotionAir Zigbee devices.

## Features

- Automatically downloads the latest firmware from GitHub Releases
- Places firmware files in the ZHA OTA directory (`/config/zigpy_ota/`)
- Periodic update checks (every 6 hours)
- Supports ZHA integration for seamless Zigbee OTA updates

## Installation

### Via HACS (Recommended)

1. Open HACS in your Home Assistant
2. Click the three dots menu → **Custom repositories**
3. Add this repository URL, select **Integration** as the category
4. Click **Add** → Find "eMotion Air" → Click **Download**
5. Restart Home Assistant

### Manual Installation

1. Copy the `custom_components/emotionair` folder to your `/config/custom_components/` directory
2. Restart Home Assistant

## Configuration

1. Go to **Settings** → **Devices & Services** → **Add Integration**
2. Search for **eMotion Air**
3. Follow the setup wizard

## How It Works

1. The integration periodically checks for new firmware releases
2. When a new version is found, it downloads the `.zigbee` firmware file
3. The file is placed in `/config/zigpy_ota/` where ZHA can find it
4. Your eMotionAir device will receive the update during its next OTA query

## Device Info

- **Manufacturer Code:** `0x4231`
- **Image Type:** `0x0301`
- **Product:** eMotionAir
