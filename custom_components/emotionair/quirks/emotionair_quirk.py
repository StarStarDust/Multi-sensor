"""Quirk for LinknLink eMotion Air Smart Button Controller."""

from zigpy.profiles import zha
from zigpy.quirks import CustomCluster, CustomDevice
from zigpy.zcl.clusters.general import Basic, Identify, MultistateInput, OnOff, PowerConfiguration, LevelControl, Groups, Ota
from zigpy.zcl.clusters.measurement import IlluminanceMeasurement, TemperatureMeasurement, RelativeHumidity, OccupancySensing
from zigpy.zcl.clusters.lightlink import LightLink

eMotionAir_MANUFACTURER = "LinknLink" # Replace with the real manufacturer from firmware
eMotionAir_MODEL = "eMotion Air"      # Replace with the real model from firmware

class eMotionAirMultistateInputCluster(CustomCluster, MultistateInput):
    """Custom Multistate Input cluster to intercept PresentValue reports and convert to zha_event."""
    
    cluster_id = MultistateInput.cluster_id
    
    def _update_attribute(self, attrid, value):
        super()._update_attribute(attrid, value)
        
        # 0x0055 (85) is the PresentValue attribute
        if attrid == 0x0055:
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
                # Send ZHA event
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
    """eMotion Air custom Quirk device."""

    # 1. Signature: Must exactly match your firmware device's joining Signature
    signature = {
        "models_info": [(eMotionAir_MANUFACTURER, eMotionAir_MODEL)],
        "endpoints": {
            1: {
                "profile_id": 0x0104,
                "device_type": 0x0850,
                "input_clusters": [
                    Basic.cluster_id,
                    Identify.cluster_id,
                    TemperatureMeasurement.cluster_id,
                    RelativeHumidity.cluster_id,
                    IlluminanceMeasurement.cluster_id,
                    OccupancySensing.cluster_id,
                    PowerConfiguration.cluster_id,
                    MultistateInput.cluster_id,
                ],
                "output_clusters": [
                    Groups.cluster_id,
                    OnOff.cluster_id,
                    LevelControl.cluster_id,
                    Ota.cluster_id,
                    LightLink.cluster_id,
                ],
            }
        },
    }

    # 2. Replacement: Replace native MultistateInput with our eMotionAirMultistateInputCluster
    replacement = {
        "endpoints": {
            1: {
                "profile_id": 0x0104,
                "device_type": 0x0850,
                "input_clusters": [
                    Basic.cluster_id,
                    Identify.cluster_id,
                    TemperatureMeasurement.cluster_id,
                    RelativeHumidity.cluster_id,
                    IlluminanceMeasurement.cluster_id,
                    OccupancySensing.cluster_id,
                    PowerConfiguration.cluster_id,
                    eMotionAirMultistateInputCluster, # Intercept and send zha_event
                ],
                "output_clusters": [
                    Groups.cluster_id,
                    OnOff.cluster_id,
                    LevelControl.cluster_id,
                    Ota.cluster_id,
                    LightLink.cluster_id,
                ],
            }
        }
    }
