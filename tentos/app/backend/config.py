"""Application configuration."""
import json
import os
from pathlib import Path
from pydantic_settings import BaseSettings
from pydantic import Field


def get_data_path() -> Path:
    """Get data path - local dev or HA container."""
    if Path("/data").exists():
        return Path("/data")
    # Local dev - use ./data relative to this file
    local_data = Path(__file__).parent / "data"
    local_data.mkdir(exist_ok=True)
    return local_data


def get_options_path() -> Path:
    """Get options.json path."""
    data = get_data_path()
    return data / "options.json"


class Settings(BaseSettings):
    """Application settings loaded from environment and add-on options."""

    log_level: str = Field(default="info")
    ha_url: str = Field(default="http://supervisor/core")
    supervisor_token: str = Field(default="")
    hassio_token: str = Field(default="")
    ingress_path: str = Field(default="")

    class Config:
        env_prefix = ""
        case_sensitive = False

    @property
    def data_path(self) -> Path:
        return get_data_path()

    @property
    def db_path(self) -> Path:
        return self.data_path / "tent_garden.db"

    @property
    def ha_token(self) -> str:
        """Get the HA API token."""
        return self.supervisor_token or self.hassio_token

    @property
    def is_dev_mode(self) -> bool:
        """Check if running in local dev mode."""
        return not Path("/data").exists()

    def load_addon_options(self) -> dict:
        """Load add-on options from options.json."""
        options_path = get_options_path()
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
    """Load tent configurations from config.json (tent builder) or fallback to options.json."""
    data_path = get_data_path()

    # First try config.json (saved by tent builder UI)
    config_path = data_path / "config.json"
    if config_path.exists():
        try:
            with open(config_path) as f:
                config = json.load(f)
            tents = config.get("tents", [])
            if tents:
                return [TentConfig(t) for t in tents]
        except Exception:
            pass

    # Fallback to options.json (HA add-on config)
    options_path = get_options_path()
    if options_path.exists():
        try:
            with open(options_path) as f:
                options = json.load(f)
            tents = options.get("tents", [])
            return [TentConfig(t) for t in tents]
        except Exception:
            pass

    return []


settings = Settings()
