// pvvx / Telink Standard OTA UUIDs
const TELINK_OTA_SERVICE_UUID = '00010203-0405-0607-0809-0a0b0c0d1912';
const TELINK_OTA_CHARACTERISTIC_UUID = '00010203-0405-0607-0809-0a0b0c0d2b12'; // 修正为 2b12

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
        addLog('GATT 已连接，等待连接稳定...', 'system');
        await new Promise(r => setTimeout(r, 500));

        addLog('正在发现服务...', 'system');
        const service = await server.getPrimaryService(TELINK_OTA_SERVICE_UUID);
        otaCharacteristic = await service.getCharacteristic(TELINK_OTA_CHARACTERISTIC_UUID);

        addLog('OTA 服务就绪 (pvvx 兼容模式)', 'success');
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

// OTA 逻辑实现 (对齐 pvvx 稳定性补丁)
async function startUpgrade() {
    if (!otaCharacteristic || !firmwareBuffer) return;

    upgradeBtn.disabled = true;
    connectBtn.disabled = true;
    progressContainer.style.display = 'flex';
    progressFill.style.width = '0%';
    progressPercent.innerText = '0%';

    addLog('启动 OTA 流程 (pvvx 稳定性策略)...', 'system');

    try {
        const data = new Uint8Array(firmwareBuffer);
        const totalSize = data.length;
        const chunkSize = 16; 
        const totalChunks = Math.ceil(totalSize / chunkSize);

        // 1. pvvx 握手序列
        addLog('发送握手指令...', 'system');
        await otaCharacteristic.writeValueWithoutResponse(new Uint8Array([0x00, 0xff]));
        await otaCharacteristic.writeValueWithoutResponse(new Uint8Array([0x01, 0xff]));
        
        // 关键延时：给芯片时间准备 Flash 擦除
        addLog('等待 300ms 准备 Flash...', 'system');
        await new Promise(r => setTimeout(r, 300));

        // 2. 循环发送固件数据
        for (let i = 0; i < totalChunks; i++) {
            const offset = i * chunkSize;
            const chunk = new Uint8Array(chunkSize).fill(0xff); 
            const actualSize = Math.min(chunkSize, totalSize - offset);
            chunk.set(data.slice(offset, offset + actualSize));

            // 发送数据包
            await sendOtaPacket(i, chunk);

            // 关键稳定性补丁：每 8 包进行一次 readValue 强制同步
            if (i > 0 && i % 8 === 0) {
                await otaCharacteristic.readValue(); 
            }

            // 更新进度
            if (i % 20 === 0 || i === totalChunks - 1) {
                const percent = Math.round((i / totalChunks) * 100);
                progressFill.style.width = `${percent}%`;
                progressPercent.innerText = `${percent}%`;
            }
        }

        // 3. pvvx 结束序列 [0x02, 0xff, index_L, index_H, ~index_L, ~index_H]
        const lastIdx = totalChunks - 1;
        const endPacket = new Uint8Array(6);
        endPacket[0] = 0x02;
        endPacket[1] = 0xff;
        endPacket[2] = lastIdx & 0xff;
        endPacket[3] = (lastIdx >> 8) & 0xff;
        endPacket[4] = (~lastIdx) & 0xff;
        endPacket[5] = ((~lastIdx) >> 8) & 0xff;
        
        await otaCharacteristic.writeValueWithoutResponse(endPacket);

        addLog('OTA 传输成功！设备正在重启并应用固件...', 'success');
        progressFill.style.width = '100%';
        progressPercent.innerText = '100%';

    } catch (error) {
        addLog(`OTA 失败: ${error.message}`, 'error');
    } finally {
        connectBtn.disabled = false;
        upgradeBtn.disabled = false;
    }
}

async function sendOtaPacket(index, chunk) {
    const packet = new Uint8Array(20);
    packet[0] = index & 0xff;
    packet[1] = (index >> 8) & 0xff;
    packet.set(chunk, 2);
    
    // CRC16-Modbus (pvvx 兼容)
    const crc = crc16_modbus(packet.slice(0, 18));
    packet[18] = crc & 0xff;
    packet[19] = (crc >> 8) & 0xff;

    await otaCharacteristic.writeValueWithoutResponse(packet);
}

// CRC16-Modbus 算法
function crc16_modbus(data) {
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
