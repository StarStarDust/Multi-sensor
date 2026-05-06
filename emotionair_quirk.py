"""Quirk for LinknLink eMotion Air Smart Button Controller."""

from zigpy.profiles import zha
from zigpy.quirks import CustomCluster, CustomDevice
from zigpy.zcl.clusters.general import Basic, MultistateInput, OnOff, PowerConfiguration, LevelControl
from zigpy.zcl.clusters.measurement import IlluminanceMeasurement, TemperatureMeasurement, RelativeHumidity, OccupancySensing

eMotionAir_MANUFACTURER = "LinknLink" # 替换为固件中的真�?manufacturer
eMotionAir_MODEL = "eMotion Air"      # 替换为固件中的真�?model

class eMotionAirMultistateInputCluster(CustomCluster, MultistateInput):
    """自定义多态输入簇，用于拦�?PresentValue 属性上报并转换�?zha_event."""
    
    cluster_id = MultistateInput.cluster_id
    
    def _update_attribute(self, attrid, value):
        super()._update_attribute(attrid, value)
        
        # 0x0055 (85) �?PresentValue 属�?        if attrid == 0x0055:
            action = None
            if value == 1:
                action = "single"
            elif value == 2:
                action = "double"
            elif value == 3:
                action = "triple"
            elif value == 4:
                action = "hold"
            elif value == 0:
                action = "release"
                
            if action:
                # 发�?ZHA 事件
                self.listener_event(
                    "zha_send_event",
                    action,
                    {
                        "command": action,
                        "value": value,
                        "endpoint_id": self._endpoint.endpoint_id
                    },
                )

class eMotionAirButtonQuirk(CustomDevice):
    """eMotion Air 自定�?Quirk 设备."""

    # 1. 签名：必须与你的固件设备入网时的 Signature 完全匹配
    signature = {
        "models_info": [(eMotionAir_MANUFACTURER, eMotionAir_MODEL)],
        "endpoints": {
            1: {
                "profile_id": zha.PROFILE_ID,
                # 注意：这里的 device_type �?clusters 必须严格和你固件中一�?                "device_type": zha.DeviceType.ON_OFF_SWITCH, 
                "input_clusters": [
                    Basic.cluster_id,
                    PowerConfiguration.cluster_id,
                    MultistateInput.cluster_id,
                    IlluminanceMeasurement.cluster_id,
                    TemperatureMeasurement.cluster_id,
                    RelativeHumidity.cluster_id,
                    OccupancySensing.cluster_id,
                ],
                "output_clusters": [
                    OnOff.cluster_id,
                    LevelControl.cluster_id,
                ],
            }
        },
    }

    # 2. 替换：将原生�?MultistateInput 替换为我们的 eMotionAirMultistateInputCluster
    replacement = {
        "endpoints": {
            1: {
                "profile_id": zha.PROFILE_ID,
                "device_type": zha.DeviceType.ON_OFF_SWITCH,
                "input_clusters": [
                    Basic.cluster_id,
                    PowerConfiguration.cluster_id,
                    eMotionAirMultistateInputCluster, # 拦截并发�?zha_event
                    IlluminanceMeasurement.cluster_id,
                    TemperatureMeasurement.cluster_id,
                    RelativeHumidity.cluster_id,
                    OccupancySensing.cluster_id,
                ],
                "output_clusters": [
                    OnOff.cluster_id,
                    LevelControl.cluster_id,
                ],
            }
        }
    }
