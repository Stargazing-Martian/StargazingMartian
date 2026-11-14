FROM python:3.10-slim

WORKDIR /app

ENV GDAL_CACHEMAX=256
ENV GDAL_HTTP_MERGE_CONSECUTIVE_RANGES=YES
ENV GDAL_HTTP_MULTIPLEX=YES
ENV GDAL_INGESTED_BYTES_AT_OPEN=32768
ENV GDAL_HTTP_VERSION=2
ENV VSI_CACHE=TRUE


COPY pyproject.toml poetry.lock /app/

RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc \
    && pip install --no-cache-dir "poetry==1.8.5" \
    && poetry config virtualenvs.create false \
    && poetry install --only main --no-root \
    && apt-get remove -y gcc \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/* /root/.cache/pip

COPY ./ctod /app/ctod/
COPY ./config /app/config/
COPY ./scripts /app/scripts/
COPY start_server.py /app/

EXPOSE 5000

CMD ["python", "start_server.py"]
