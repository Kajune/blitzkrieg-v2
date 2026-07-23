# Vector tiles
docker run --rm -e JAVA_TOOL_OPTIONS="-Xmx16g" \
	-v $PWD/data:/data -v $PWD/osm:/osm \
	ghcr.io/onthegomap/planetiler:latest \
	--osm-path /osm/japan-260618.osm.pbf --area japan --maxzoom 16

# Hillshade tiles
docker run --rm \
	-v $PWD:/work osgeo/gdal:ubuntu-small-3.6.3 \
	sh -c "cd /work && ./make_hillshade.sh"
