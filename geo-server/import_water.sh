#!/bin/bash

source .env

docker exec -it ${POSTGIS_CONTAINER} psql \
	-U ${POSTGRES_USER} -d ${POSTGRES_DB} \
	-c "DROP TABLE IF EXISTS public.osm_water_polygons;"

shp2pgsql -I -s 3857 water/water_polygons.shp public.osm_water_polygons | \
	docker exec -i ${POSTGIS_CONTAINER} psql \
	-U ${POSTGRES_USER} -d ${POSTGRES_DB}
