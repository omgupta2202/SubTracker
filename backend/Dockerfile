# SubTracker backend — production image for Fly.io / any Docker host.
#
# Why python:3.11-slim:
#   - Matches the project's lowest-deployed Python version constraints
#     (PEP-604 union types are quoted as strings, so 3.11 is safe).
#   - "slim" image keeps the layer small without missing libpq runtime needs
#     for psycopg2-binary.

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install runtime deps once for layer caching
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && pip install --no-cache-dir gunicorn

# App code
COPY . .

EXPOSE 8080

# Gunicorn: 2 workers is plenty for a free shared-cpu-1x VM. The wsgi app
# is `app` (the Flask instance created at import time in app.py).
# Bind to 0.0.0.0:8080 to match Fly's internal_port.
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "2", "--threads", "4", "--timeout", "60", "app:app"]
