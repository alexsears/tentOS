"""Application configuration."""
import json
import os
from pathlib import Path
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Application settings loaded from environment and add-on options."""

    log_level: str = Field(default="info")
    ha_url: str = Field(default="http://supervisor/core")
    supervisor_token: str = Field(default="")
    hassio_token: str = Field(default="")
    ingress_path: str = Field(default="")
    data_path: Path = Field(default=Path("/data"))
    db_path: Path = Field(default=Path("/data/tent_garden.db"))

    class Config:
        env_prefix = ""
        case_sensitive = False

    @property
    def ha_token(self) -> str:
        """Get the HA API token."""
        return self.supervisor_token or self.hassio_token

    def load_addon_options(self) -> dict:
        """Load add-on options from /data/options.json."""
        options_path = Path("/data/options.json")
        if options_path.exists():
            with open(options_path) as f:
                return json.load(f)
        return {}


class TentConfig:
    """Tent configuration from add-on options."""

    def __init__(self, data: dict):
        self.id = data.get("name", "").lower().replace(" ", "_")
        self.name = data.get("name", "Unnamed Tent")
        self.description = data.get("description", "")
        self.sensors = data.get("sensors", {})
        self.actuators = data.get("actuators", {})
        self.targets = data.get("targets", {})
        self.schedules = data.get("schedules", {})
        self.notifications = data.get("notifications", {})

    def get_all_entities(self) -> list[str]:
        """Get all configured entity IDs."""
        entities = []
        for entity_id in self.sensors.values():
            if entity_id:
                entities.append(entity_id)
        for entity_id in self.actuators.values():
            if entity_id:
                entities.append(entity_id)
        return entities


def load_tents_config() -> list[TentConfig]:
    """Load tent configurations from add-on options."""
    options_path = Path("/data/options.json")
    if not options_path.exists():
        return []

    with open(options_path) as f:
        options = json.load(f)

    tents = options.get("tents", [])
    return [TentConfig(t) for t in tents]


settings = Settings()
