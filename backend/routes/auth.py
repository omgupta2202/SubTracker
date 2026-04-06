# Re-export from the canonical auth module.
# Kept for backwards-compatibility with any direct imports of routes.auth.
from modules.auth.routes import bp  # noqa: F401
