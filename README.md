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
5. **Restart Home Assistant twice**
   - **First Restart**: The integration will automatically deploy the Quirk/Blueprint files and inject the necessary OTA/Quirk paths into your `configuration.yaml`.
   - **Second Restart**: Home Assistant will then load the updated configuration and properly recognize the custom Zigbee Quirk for your device.

### Manual Installation

1. Copy the `custom_components/emotionair` folder to your `/config/custom_components/` directory
2. Restart Home Assistant **twice** (as explained above).

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
6. **Note on Restarts:** Because the integration modifies your `configuration.yaml` and deploys files during its first run, a total of two restarts are required to ensure ZHA picks up the new paths and the Quirk is fully active.

## Firmware Updates

eMotion Air uses **concurrent Zigbee + Bluetooth dual-stack firmware**, meaning the features and performance are identical regardless of which protocol you use to update. We provide two update methods to suit different scenarios:

### 1. Automatic Update (via Zigbee)
If your device is already paired with Home Assistant via ZHA, updates are handled **automatically**. This integration periodically checks for new firmware and downloads the `.zigbee` package to your local OTA directory. Your device will then update itself automatically during its next check-in.

### 2. Manual Update (via Bluetooth Web Tool)
If you prefer to trigger an update manually, or if the device is not yet paired via Zigbee, you can use our web-based tool to push the `.bin` firmware file via Bluetooth (BLE).

👉 **[Launch eMotion Air Web OTA Tool](https://starstardust.github.io/Multi-sensor/bluetoothweb_ota/)**

**How to upgrade:**
1. Open the tool link in a modern browser (Chrome, Edge, or Opera).
2. **Wake up the device**: Press the physical button on your eMotion Air sensor to ensure it is advertising via Bluetooth.
3. Click **Connect Device** and select "eMotion Air" from the list.
4. Once connected, click **Start Upgrade** to begin the transmission.



## Device Info

- **Manufacturer:** `LinknLink`
- **Product:** `eMotion Air`
- **Firmware Image Type:** `0x0301`
- **Manufacturer Code:** `0x4231`
