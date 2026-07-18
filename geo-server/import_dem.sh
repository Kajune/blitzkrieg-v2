#!/bin/bash

source .env

docker exec \
	-it ${POSTGIS_CONTAINER} psql \
	-U ${POSTGRES_USER} -d ${POSTGRES_DB} \
	-c "CREATE EXTENSION postgis_raster;"

docker exec -it ${POSTGIS_CONTAINER} psql -U ${POSTGRES_USER} -d ${POSTGRES_DB} -c "DROP TABLE public.${DEM_TABLE};"

raster2pgsql -s ${DEM_EPSG} -I -C -d -M -r dem/*/*_DSM.tif -F public.${DEM_TABLE} | \
	docker exec -i ${POSTGIS_CONTAINER} psql -U ${POSTGRES_USER} -d ${POSTGRES_DB}
