"""Config flow for EmotionAir OTA integration."""
from __future__ import annotations

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult

DOMAIN = "emotionair"


class EmotionAirConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for EmotionAir OTA."""

    VERSION = 1

    async def async_step_user(self, user_input=None) -> FlowResult:
        """Handle the initial step."""
        # 防止重复添加
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        if user_input is not None:
            return self.async_create_entry(
                title="EmotionAir OTA",
                data={},
            )

        # 显示确认页面（无需用户填写任何信息）
        return self.async_show_form(step_id="user")

    @staticmethod
    def async_get_options_flow(config_entry):
        """Get the options flow."""
        return EmotionAirOptionsFlow(config_entry)


class EmotionAirOptionsFlow(config_entries.OptionsFlow):
    """Handle options for EmotionAir OTA."""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        """Initialize options flow."""
        self.config_entry = config_entry

    async def async_step_init(self, user_input=None) -> FlowResult:
        """Manage the options."""
        import voluptuous as vol

        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Optional(
                        "check_interval_hours",
                        default=self.config_entry.options.get(
                            "check_interval_hours", 6
                        ),
                    ): vol.All(vol.Coerce(int), vol.Range(min=1, max=72)),
                }
            ),
        )
