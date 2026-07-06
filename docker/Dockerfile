FROM nvidia/cuda:12.4.1-devel-ubuntu22.04

ENV PYTHONUNBUFFERED=1
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
	python3-pip \
	python3-dev \
	libgdal-dev \
	libgl1 \
    libglib2.0-0 \
	g++ \
	&& rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir \
	flask \
	rasterio \
	msgspec \
	pyproj \
	shapely \
	psycopg2 \
	opencv-python \
	scipy \
	dotenv \
	pyastar2d

ENV CUDA_PATH=/usr/local/cuda
ENV PATH=$PATH:/usr/local/cuda/bin
ENV LD_LIBRARY_PATH=$LD_LIBRARY_PATH:/usr/local/cuda/lib64
RUN pip3 install --no-cache-dir cupy-cuda12x
