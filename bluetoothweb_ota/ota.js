// Telink OTA UUIDs
const TELINK_OTA_SERVICE_UUID = '00010203-0405-0607-0809-0a0b0c0d1912';
const TELINK_OTA_CHARACTERISTIC_UUID = '00010203-0405-0607-0809-0a0b0c0d1912';

let bluetoothDevice = null;
let otaCharacteristic = null;
let firmwareBuffer = null;
let latestFirmwareInfo = null;

// UI Elements
const connectBtn = document.getElementById('connect-btn');
const upgradeBtn = document.getElementById('upgrade-btn');
const statusText = document.getElementById('status-text');
const statusDot = document.getElementById('connection-status');
const fwVersionLabel = document.getElementById('fw-version');
const fwFilenameLabel = document.getElementById('fw-filename');
const progressContainer = document.getElementById('progress-container');
const progressFill = document.getElementById('progress-fill');
const progressPercent = document.getElementById('progress-percent');
const logView = document.getElementById('log-view');

// 初始加载：获取固件版本
async function loadFirmwareInfo() {
    addLog('正在从服务器获取固件信息...', 'system');
    try {
        const response = await fetch('../ble_firmware/version.json');
        latestFirmwareInfo = await response.json();
        fwVersionLabel.innerText = latestFirmwareInfo.version;
        fwFilenameLabel.innerText = latestFirmwareInfo.file;
        addLog(`发现新固件: V${latestFirmwareInfo.version}`, 'success');
        
        // 预下载固件
        const fwResponse = await fetch(`../ble_firmware/${latestFirmwareInfo.file}`);
        firmwareBuffer = await fwResponse.arrayBuffer();
        addLog(`固件下载完成: ${(firmwareBuffer.byteLength / 1024).toFixed(1)} KB`, 'success');
    } catch (error) {
        addLog(`获取固件失败: ${error.message}`, 'error');
        fwVersionLabel.innerText = '加载失败';
    }
}

// 蓝牙连接
async function onConnectClick() {
    try {
        addLog('正在扫描设备 "eMotion Air"...', 'system');
        bluetoothDevice = await navigator.bluetooth.requestDevice({
            filters: [{ name: 'eMotion Air' }],
            optionalServices: [TELINK_OTA_SERVICE_UUID]
        });

        bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);

        addLog(`已选择设备: ${bluetoothDevice.name}`, 'system');
        statusText.innerText = '正在连接...';

        const server = await bluetoothDevice.gatt.connect();
        addLog('GATT 已连接，正在发现服务...', 'system');

        const service = await server.getPrimaryService(TELINK_OTA_SERVICE_UUID);
        otaCharacteristic = await service.getCharacteristic(TELINK_OTA_CHARACTERISTIC_UUID);

        addLog('OTA 服务就绪', 'success');
        statusText.innerText = '已连接';
        statusDot.classList.add('connected');
        connectBtn.innerText = '断开连接';
        connectBtn.onclick = onDisconnectClick;
        
        upgradeBtn.disabled = !firmwareBuffer;
    } catch (error) {
        addLog(`连接失败: ${error.message}`, 'error');
        statusText.innerText = '连接错误';
        statusDot.classList.add('error');
    }
}

function onDisconnectClick() {
    if (bluetoothDevice && bluetoothDevice.gatt.connected) {
        bluetoothDevice.gatt.disconnect();
    }
}

function onDisconnected() {
    addLog('设备已断开连接', 'system');
    statusText.innerText = '未连接';
    statusDot.classList.remove('connected');
    connectBtn.innerText = '连接设备';
    connectBtn.onclick = onConnectClick;
    upgradeBtn.disabled = true;
    progressContainer.style.display = 'none';
}

// OTA 逻辑实现
async function startUpgrade() {
    if (!otaCharacteristic || !firmwareBuffer) return;

    upgradeBtn.disabled = true;
    connectBtn.disabled = true;
    progressContainer.style.display = 'flex';
    progressFill.style.width = '0%';
    progressPercent.innerText = '0%';

    addLog('启动 OTA 流程...', 'system');

    try {
        const data = new Uint8Array(firmwareBuffer);
        const totalSize = data.length;
        const chunkSize = 16; // 泰凌微标准每包 16 字节数据
        const totalChunks = Math.ceil(totalSize / chunkSize);

        // 1. 发送 OTA Start (CMD 0xFF01 + Index 0)
        // 泰凌微格式: [Index_L, Index_H, Data[16], CRC_L, CRC_H]
        // 第一个包 Index 为 0，Data 为 0
        await sendOtaPacket(0, new Uint8Array(chunkSize).fill(0));
        addLog('OTA 握手成功，开始传输数据...', 'system');

        // 2. 循环发送固件数据
        for (let i = 0; i < totalChunks; i++) {
            const offset = i * chunkSize;
            const chunk = new Uint8Array(chunkSize).fill(0xff); // 补齐 16 字节
            const actualSize = Math.min(chunkSize, totalSize - offset);
            chunk.set(data.slice(offset, offset + actualSize));

            // 发送数据包，Index 从 1 开始 (pvvx 习惯，或者从 0 开始取决于 SDK)
            // 标准泰凌微 OTA：数据包 Index 从 0 到 N
            await sendOtaPacket(i, chunk);

            // 更新进度
            if (i % 10 === 0 || i === totalChunks - 1) {
                const percent = Math.round((i / totalChunks) * 100);
                progressFill.style.width = `${percent}%`;
                progressPercent.innerText = `${percent}%`;
            }
        }

        // 3. 发送 OTA End (CMD 0xFF02)
        // 通常最后一个包发送特定的结束指令
        const endPacket = new Uint8Array(20);
        endPacket[0] = 0x02; // CMD END (pvvx 风格或 SDK 风格)
        endPacket[1] = 0xFF;
        // 也有一些实现是发送特殊的 Index 或者直接断开
        await otaCharacteristic.writeValueWithoutResponse(endPacket);

        addLog('OTA 传输完成！设备即将重启。', 'success');
        progressFill.style.width = '100%';
        progressPercent.innerText = '100%';

    } catch (error) {
        addLog(`OTA 失败: ${error.message}`, 'error');
    } finally {
        connectBtn.disabled = false;
        upgradeBtn.disabled = false;
    }
}

// 发送单包 OTA 数据
async function sendOtaPacket(index, chunk) {
    const packet = new Uint8Array(20);
    
    // Index (Little Endian)
    packet[0] = index & 0xff;
    packet[1] = (index >> 8) & 0xff;
    
    // Data (16 bytes)
    packet.set(chunk, 2);
    
    // CRC-16 (Index + Data)
    const crc = crc16_telink(packet.slice(0, 18));
    packet[18] = crc & 0xff;
    packet[19] = (crc >> 8) & 0xff;

    // 泰凌微 OTA 必须使用 Write Without Response 以提高速度
    await otaCharacteristic.writeValueWithoutResponse(packet);
    
    // 为了防止拥塞，可以加极短的延时（视 MTU 和连接间隔而定）
    // await new Promise(r => setTimeout(r, 10)); 
}

// 泰凌微专用 CRC16
function crc16_telink(data) {
    let crc = 0xFFFF;
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (let j = 0; j < 8; j++) {
            if (crc & 1) {
                crc = (crc >> 1) ^ 0xA001;
            } else {
                crc >>= 1;
            }
        }
    }
    return crc;
}

function addLog(message, type = '') {
    const entry = document.createElement('p');
    entry.className = `log-entry ${type}`;
    const time = new Date().toLocaleTimeString([], { hour12: false });
    entry.innerText = `[${time}] ${message}`;
    logView.appendChild(entry);
    logView.scrollTop = logView.scrollHeight;
}

// Event Listeners
connectBtn.onclick = onConnectClick;
upgradeBtn.onclick = startUpgrade;

// Init
loadFirmwareInfo();
