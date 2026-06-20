#!/bin/bash

source .env

osm2pgsql \
	-d ${POSTGRES_DB} \
	-H localhost \
	-U ${POSTGRES_USER} -W \
	-S /usr/share/osm2pgsql/default.style \
	osm/*.osm.pbf
