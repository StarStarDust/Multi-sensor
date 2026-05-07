// Telink OTA & SPP UUIDs
const GENERIC_ACCESS_SERVICE_UUID = '00001800-0000-1000-8000-00805f9b34fb';
const DEVICE_NAME_UUID = '00002a00-0000-1000-8000-00805f9b34fb';
const FIRMWARE_VER_UUID = '00002a26-0000-1000-8000-00805f9b34fb';
const DEVICE_INFO_SERVICE_UUID = '0000180a-0000-1000-8000-00805f9b34fb';
const AES_KEY_UUID = '00010203-0405-0607-0809-0a0b0c0d2b14';

const TELINK_OTA_SERVICE_UUID = '00010203-0405-0607-0809-0a0b0c0d1912';
const TELINK_OTA_CHARACTERISTIC_UUID = '00010203-0405-0607-0809-0a0b0c0d2b12';
const TELINK_SPP_SERVICE_UUID = '00010203-0405-0607-0809-0a0b0c0d1910';
const TELINK_SPP_S2C_UUID = '00010203-0405-0607-0809-0a0b0c0d2b10';
const TELINK_SPP_C2S_UUID = '00010203-0405-0607-0809-0a0b0c0d2b11';

let bluetoothDevice = null;
let otaCharacteristic = null;
let sppS2CCharacteristic = null;
let sppC2SCharacteristic = null;
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
const mainNav = document.getElementById('main-nav');
const readKeyBtn = document.getElementById('read-key-btn');
const aesKeyVal = document.getElementById('aes-key-val');

// Tab Switching Logic
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    };
});

// AES Key 读取逻辑
async function onReadKeyClick() {
    if (!bluetoothDevice || !bluetoothDevice.gatt.connected) {
        addLog('请先连接设备', 'error');
        return;
    }
    try {
        addLog('正在读取 AES CCM Key...', 'system');
        const service = await bluetoothDevice.gatt.getPrimaryService(DEVICE_INFO_SERVICE_UUID);
        const char = await service.getCharacteristic(AES_KEY_UUID);
        const val = await char.readValue();
        
        // 转换为紧凑的 HEX 字符串（无空格）
        const hex = Array.from(new Uint8Array(val.buffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
        
        aesKeyVal.innerText = hex.toUpperCase();
        addLog('AES Key 读取成功', 'success');
    } catch (error) {
        addLog(`读取 Key 失败: ${error.message}`, 'error');
    }
}

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
        addLog('正在扫描以 "eMotion Air" 开头的设备...', 'system');
        bluetoothDevice = await navigator.bluetooth.requestDevice({
            filters: [{ namePrefix: 'eMotion Air' }],
            optionalServices: [
                GENERIC_ACCESS_SERVICE_UUID, 
                DEVICE_INFO_SERVICE_UUID, 
                TELINK_OTA_SERVICE_UUID, 
                TELINK_SPP_SERVICE_UUID
            ]
        });

        bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);
        readKeyBtn.onclick = onReadKeyClick;

        addLog(`已选择设备: ${bluetoothDevice.name}`, 'system');
        statusText.innerText = '正在连接...';

        const server = await bluetoothDevice.gatt.connect();
        addLog('GATT 已连接，等待连接稳定...', 'system');
        await new Promise(r => setTimeout(r, 500));

        addLog('正在同步设备状态...', 'system');
        
        // 1. 读取基础设备信息 (0x1800)
        try {
            const gapService = await server.getPrimaryService(GENERIC_ACCESS_SERVICE_UUID);
            
            // 读取名称
            try {
                const nameChar = await gapService.getCharacteristic(DEVICE_NAME_UUID);
                const nameVal = await nameChar.readValue();
                const deviceName = new TextDecoder().decode(nameVal).replace(/[^\x20-\x7E]/g, '').trim();
                document.getElementById('target-device-name').innerText = deviceName;
                addLog(`设备名称: ${deviceName}`, 'system');
            } catch (e) { addLog('读取设备名称失败', 'error'); }

            // 读取版本 (增加容错，因为固件中 0x2A26 的句柄可能定义错误)
            try {
                const fwChar = await gapService.getCharacteristic(FIRMWARE_VER_UUID);
                const fwVal = await fwChar.readValue();
                const fwVer = new TextDecoder().decode(fwVal).replace(/[^\x20-\x7E]/g, '').trim();
                document.getElementById('current-device-version').innerText = fwVer;
                document.getElementById('device-ota-version').innerText = fwVer;
                addLog(`设备固件版本: ${fwVer}`, 'system');
            } catch (e) {
                addLog('固件版本读取受限 (UUID 0x2A26 未就绪)', 'system');
                document.getElementById('current-device-version').innerText = '未知';
            }
        } catch (gapError) {
            addLog('无法访问基础信息服务', 'system');
        }

        // 2. 获取 OTA 特征值
        const otaService = await server.getPrimaryService(TELINK_OTA_SERVICE_UUID);
        otaCharacteristic = await otaService.getCharacteristic(TELINK_OTA_CHARACTERISTIC_UUID);
        
        // 3. 获取 SPP 数据并开启通知
        try {
            const sppService = await server.getPrimaryService(TELINK_SPP_SERVICE_UUID);
            
            addLog('正在同步初始传感器状态...', 'system');
            await new Promise(r => setTimeout(r, 1000));

            // 主动读取 0x2B11 (C2S 通道)
            sppC2SCharacteristic = await sppService.getCharacteristic(TELINK_SPP_C2S_UUID);
            const initialData = await sppC2SCharacteristic.readValue();
            handleSensorData({ target: { value: initialData } });
            addLog('数据同步成功', 'success');

            // 开启持续通知 (0x2B10)
            sppS2CCharacteristic = await sppService.getCharacteristic(TELINK_SPP_S2C_UUID);
            sppS2CCharacteristic.addEventListener('characteristicvaluechanged', handleSensorData);
            await sppS2CCharacteristic.startNotifications();
            addLog('实时监控通道已开启', 'success');
            
            mainNav.style.display = 'flex';
        } catch (sppError) {
            addLog(`SPP 数据初始化失败: ${sppError.message}`, 'system');
        }

        addLog('设备已就绪', 'success');
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

// 传感器数据解析逻辑
function handleSensorData(event) {
    const value = event.target.value;
    // 固件推送的是 DevData_t 结构体，长度为 15 字节
    if (value.byteLength < 15) return;

    // 解析电量 (Offset 0: ID, Offset 1: Value)
    const battery = value.getUint8(1);
    document.getElementById('val-bat').innerText = battery;

    // 解析温度 (Offset 2: ID, Offset 3-4: Value, int16, factor 0.1)
    const tempRaw = value.getInt16(3, true); // Little Endian
    document.getElementById('val-temp').innerText = (tempRaw / 10).toFixed(1);

    // 解析湿度 (Offset 5: ID, Offset 6: Value)
    const humidity = value.getUint8(6);
    document.getElementById('val-hum').innerText = humidity;

    // 解析亮度 (Offset 7: ID, Offset 8-10: Value, uint24, factor 0.01)
    const luxRaw = value.getUint8(8) | (value.getUint8(9) << 8) | (value.getUint8(10) << 16);
    document.getElementById('val-lux').innerText = (luxRaw / 100).toFixed(0);

    // 解析人体感应 (Offset 11: ID, Offset 12: Value)
    const motion = value.getUint8(12);
    document.getElementById('val-motion').innerText = motion === 1 ? '有人' : '无人';
    document.getElementById('val-motion').style.color = motion === 1 ? '#f43f5e' : '#2dd4bf';

    // 解析按键事件 (Offset 13: ID, Offset 14: Value)
    const buttonEvt = value.getUint8(14);
    const evtNames = {
        0x00: '无',
        0x01: '单击',
        0x02: '双击',
        0x03: '三击',
        0x04: '长按',
        0x05: '双击长按',
        0x06: '三击长按',
        0x80: '保持'
    };
    if (buttonEvt !== 0) {
        document.getElementById('val-button').innerText = evtNames[buttonEvt] || `未知(${buttonEvt})`;
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
