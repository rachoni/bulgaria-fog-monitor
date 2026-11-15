# Use official lightweight Python image
FROM python:3.10-slim

# Set working directory inside container
WORKDIR /app

# Install system dependencies required for geospatial libraries (GDAL, GEOS, PROJ, SpatialIndex)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gdal-bin \
    libgdal-dev \
    libspatialindex-dev \
    libproj-dev \
    libgeos-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set environment variables for GDAL/OSMnx
ENV CPLUS_INCLUDE_PATH=/usr/include/gdal
ENV C_INCLUDE_PATH=/usr/include/gdal

# Upgrade pip and install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy project source code into the container
COPY . .

# Expose port for FastAPI backend
EXPOSE 8000

# Run Uvicorn server bound to 0.0.0.0 for multi-platform network accessibility
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]