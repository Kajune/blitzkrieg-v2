#!/bin/bash

source .env

docker exec \
 	-it ${POSTGIS_CONTAINER} psql \
 	-U ${POSTGRES_USER} -d ${POSTGRES_DB} \
 	-c "CREATE EXTENSION postgis_raster;"

raster2pgsql -s ${DEM_EPSG} -I -C -d -M dem/*/*.tif -F public.${DEM_TABLE} | \
	docker exec -i ${POSTGIS_CONTAINER} psql -U ${POSTGRES_USER} -d ${POSTGRES_DB}
